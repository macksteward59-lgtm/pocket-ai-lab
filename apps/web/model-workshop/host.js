export async function hostRequest(input) {
  const options = input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {};
  let response;
  try { response = await fetch("/api/model-workshop", options); }
  catch { throw Error("The local training host is offline."); }
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "The local training host rejected the request.");
  if (input?.op === "answer" && (result.model !== input.model || typeof result.answer !== "string" || !result.answer.trim())) {
    throw Error("The training host did not return an answer from the selected model.");
  }
  return result;
}
export function hostModel(record) {
  return { ...record, hash: record.weightsSHA256, location: "host" };
}
