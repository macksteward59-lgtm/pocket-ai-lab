export const MAX_HISTORY_TURNS = 32;
export const MAX_HISTORY_CHARACTERS = 24000;
export const MAX_TURN_CHARACTERS = 12000;

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// This is ordinary conversation text, never internal AgentMessage context or authority.
export function validateConversation(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid("Conversation history must be an array.");
  if (value.length > MAX_HISTORY_TURNS) throw invalid("Conversation history has too many messages.", 413);
  let characters = 0;
  return value.map(turn => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn) ||
        Object.keys(turn).some(key => key !== "role" && key !== "content") ||
        !["user", "assistant"].includes(turn.role) ||
        typeof turn.content !== "string" || !turn.content.trim()) {
      throw invalid("History messages require only a user or assistant role and non-empty text.");
    }
    characters += turn.content.length;
    if (turn.content.length > MAX_TURN_CHARACTERS || characters > MAX_HISTORY_CHARACTERS) {
      throw invalid("Conversation history exceeds the text limit.", 413);
    }
    return { role: turn.role, content: turn.content };
  });
}

// Select complete exchanges from this conversation. Keep pairs intact and preserve
// order; draft-authoring instructions and failed/pending replies are not replayed.
export function recentConversation({ messages, turns }) {
  const byId = new Map(messages.map(message => [message.id, message]));
  const pairs = [];
  for (const turn of turns) {
    if (turn.status !== "complete" || !["chat", "reader"].includes(turn.kind)) continue;
    const user = byId.get(turn.userMessageId), assistant = byId.get(turn.assistantMessageId);
    if (!user || !assistant || user.role !== "user" || assistant.role !== "assistant" ||
        !user.text.trim() || !assistant.text.trim()) continue;
    pairs.push([user, assistant]);
  }
  const selected = [];
  let characters = 0;
  for (let index = pairs.length - 1; index >= 0; index--) {
    const pair = pairs[index];
    const size = pair[0].text.length + pair[1].text.length;
    if (pair.some(message => message.text.length > MAX_TURN_CHARACTERS) ||
        characters + size > MAX_HISTORY_CHARACTERS || selected.length + 2 > MAX_HISTORY_TURNS) break;
    selected.unshift(...pair);
    characters += size;
  }
  // JSON escaping and multi-byte text must also fit the inherited 64 KiB HTTP cap
  // alongside a 12,000-character prompt. Keep a conservative byte budget here.
  while (selected.length && new TextEncoder().encode(JSON.stringify(selected.map(message =>
    ({ role: message.role, content: message.text })))).length > 26000) selected.splice(0, 2);
  return {
    conversation: selected.map(message => ({ role: message.role, content: message.text })),
    contextMessageIds: selected.map(message => message.id),
    omittedExchanges: pairs.length - selected.length / 2
  };
}

export function draftAuthoringPrompt(kind, request) {
  if (!["tool", "agent", "team"].includes(kind)) throw invalid("Choose a supported draft kind.");
  return `Create an editable ${kind} definition draft for the user's request below. Do not run tools, activate agents, claim permissions, or claim execution. Return your reply as one JSON object with exactly three string fields: name (1-120 characters), description (1-4000 characters), instructions (1-12000 characters). Instructions describe proposed behavior and implementation requirements. For teams describe members and responsibilities; for tools describe inputs, outputs and the implementation needed. Do not include markdown fences or additional fields in that draft. Preserve the required outer chat-response format: its analysis string must contain the serialized draft JSON; do not put draft fields on the outer response.\n\nUser request:\n${request}`;
}

export function parseResourceDraft(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw invalid("The model did not return a valid definition draft. Its reply is kept in this chat; you can use Create to edit a draft yourself."); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 3 ||
      Object.keys(value).some(key => !["name", "description", "instructions"].includes(key))) {
    throw invalid("The model returned an unsupported draft shape. No capability was created or activated.");
  }
  for (const [key, limit] of [["name", 120], ["description", 4000], ["instructions", 12000]]) {
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > limit) {
      throw invalid("The model draft's " + key + " is missing or too long. Its reply is kept for review.");
    }
  }
  return { name: value.name.trim(), description: value.description, instructions: value.instructions };
}

export function boundedChatRequest(message, history) {
  if (typeof message !== "string" || !message.trim() || message.length > MAX_TURN_CHARACTERS) {
    throw invalid("This request is too long. Shorten the message; a definition request also needs room for its format instructions.", 413);
  }
  const conversation = validateConversation(history.conversation);
  const contextMessageIds = [...history.contextMessageIds];
  let body = JSON.stringify({ message, conversation });
  while (conversation.length && new TextEncoder().encode(body).length > 65536) {
    conversation.splice(0, 2);
    contextMessageIds.splice(0, 2);
    body = JSON.stringify({ message, conversation });
  }
  if (new TextEncoder().encode(body).length > 65536) {
    throw invalid("This message exceeds the request byte limit. Shorten it before sending.", 413);
  }
  return { body, contextMessageIds, omittedExchanges: history.omittedExchanges + (history.conversation.length - conversation.length) / 2 };
}
