/**
 * Bounded multi-step execution loop for the Director.
 *
 * The model may propose only the existing structured command vocabulary or
 * one of three explicit task-control outcomes. Tool results are snapshotted,
 * size-limited, and returned as untrusted history on the next model turn.
 * This runner does not grant permissions: every command still passes through
 * DirectorCommandRouter and its approval-enforcing capability ports.
 */
import {
  DIRECTOR_COMMAND_KINDS,
  DirectorCommandRouter,
  parseDirectorCommand,
} from "./DirectorCommandRouter";

export type DirectorTaskControl =
  | { kind: "complete"; summary: string }
  | { kind: "blocked"; reason: string }
  | { kind: "needs-input"; question: string };

export interface DirectorTaskHistoryEntry {
  readonly step: number;
  readonly commandKind: string;
  readonly trust: "untrusted-tool-output";
  readonly result: unknown;
}

export interface DirectorTaskProvider {
  propose(input: {
    taskId: string;
    objective: string;
    availableCommands: readonly string[];
    history: readonly DirectorTaskHistoryEntry[];
    remainingSteps: number;
  }): Promise<unknown>;
}

export type DirectorTaskResult =
  | { status: "completed"; steps: number; summary: string; history: readonly DirectorTaskHistoryEntry[] }
  | { status: "blocked"; steps: number; reason: string; history: readonly DirectorTaskHistoryEntry[] }
  | { status: "needs-input"; steps: number; question: string; history: readonly DirectorTaskHistoryEntry[] };

export interface DirectorTaskRunnerOptions {
  /** Maximum tool dispatches for one task. Defaults to 8; hard ceiling is 20. */
  maxSteps?: number;
}

const CONTROL_COMMANDS = ["complete", "blocked", "needs-input"] as const;
const RESULT_PREVIEW_LIMIT = 6_000;

export class DirectorTaskRunner {
  private readonly maxSteps: number;

  constructor(
    private readonly router: DirectorCommandRouter,
    options: DirectorTaskRunnerOptions = {}
  ) {
    const maxSteps = options.maxSteps ?? 8;
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) {
      throw new Error("maxSteps must be an integer between 1 and 20");
    }
    this.maxSteps = maxSteps;
  }

  async run(
    provider: DirectorTaskProvider,
    context: { taskId: string },
    objective: string
  ): Promise<DirectorTaskResult> {
    if (!provider || typeof provider.propose !== "function") {
      throw new Error("Director task provider is not configured");
    }
    if (!context?.taskId?.trim() || typeof objective !== "string" || !objective.trim()) {
      throw new Error("Task id and objective are required");
    }

    const history: DirectorTaskHistoryEntry[] = [];
    const availableCommands = Object.freeze([
      ...DIRECTOR_COMMAND_KINDS,
      ...CONTROL_COMMANDS
    ]);

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const response = await provider.propose({
        taskId: context.taskId,
        objective: objective.trim(),
        availableCommands,
        history: freezeHistory(history),
        remainingSteps: this.maxSteps - step + 1
      });

      const control = parseTaskControl(response);
      if (control?.kind === "complete") {
        return { status: "completed", steps: history.length, summary: control.summary, history: freezeHistory(history) };
      }
      if (control?.kind === "blocked") {
        return { status: "blocked", steps: history.length, reason: control.reason, history: freezeHistory(history) };
      }
      if (control?.kind === "needs-input") {
        return { status: "needs-input", steps: history.length, question: control.question, history: freezeHistory(history) };
      }

      // Validate the model proposal before dispatch. The router validates it
      // again at its trust boundary, so callers cannot bypass its checks.
      const command = parseDirectorCommand(response);
      const result = await this.router.dispatch(context, command);
      history.push(deepFreeze({
        step,
        commandKind: command.kind,
        trust: "untrusted-tool-output" as const,
        result: boundedSnapshot(result)
      }));
    }

    return {
      status: "blocked",
      steps: history.length,
      reason: "Maximum Director task steps reached; explicit completion was not received.",
      history: freezeHistory(history)
    };
  }
}

function parseTaskControl(input: unknown): DirectorTaskControl | undefined {
  if (!isRecord(input) || typeof input.kind !== "string" || !CONTROL_COMMANDS.includes(input.kind as typeof CONTROL_COMMANDS[number])) {
    return undefined;
  }
  const expected = input.kind === "complete" ? "summary" : input.kind === "blocked" ? "reason" : "question";
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes("kind") || !keys.includes(expected)) {
    throw new Error("Director task control must contain only kind and " + expected);
  }
  const value = input[expected];
  if (typeof value !== "string" || !value.trim() || value.length > 2_000) {
    throw new Error(expected + " must be a non-empty string of at most 2000 characters");
  }
  return { kind: input.kind as DirectorTaskControl["kind"], [expected]: value.trim() } as DirectorTaskControl;
}

function boundedSnapshot(value: unknown): unknown {
  const safe = snapshotValue(value, 0, new WeakSet<object>());
  let serialized: string;
  try {
    serialized = JSON.stringify(safe);
  } catch {
    return "[unserializable tool result omitted]";
  }
  if (serialized.length <= RESULT_PREVIEW_LIMIT) return safe;
  return {
    truncated: true,
    preview: serialized.slice(0, RESULT_PREVIEW_LIMIT),
    omittedCharacters: serialized.length - RESULT_PREVIEW_LIMIT
  };
}

function snapshotValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  }
  if (typeof value === "string") return value.slice(0, 1_500);
  if (typeof value === "undefined") return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return "[non-data value omitted]";
  if (seen.has(value)) return "[circular reference omitted]";
  if (depth >= 4) return "[maximum result depth reached]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 12).map(item => snapshotValue(item, depth + 1, seen));
  }
  if (value instanceof Error) {
    return { name: value.name.slice(0, 100), message: value.message.slice(0, 1_500) };
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).slice(0, 30)) {
    if (/(secret|token|password|credential|authorization|approval.?ref|private.?key)/i.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = snapshotValue((value as Record<string, unknown>)[key], depth + 1, seen);
  }
  return output;
}

function freezeHistory(history: readonly DirectorTaskHistoryEntry[]): readonly DirectorTaskHistoryEntry[] {
  return deepFreeze(history.map(entry => ({
    step: entry.step,
    commandKind: entry.commandKind,
    trust: entry.trust,
    result: entry.result
  })));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
