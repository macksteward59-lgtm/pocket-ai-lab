import { CLOUD_ANALYSIS_LIMITS } from "../../../packages/intelligence/serverless/cloud-analysis/types";

/** One bounded local stdin reader shared by the provider-specific preview CLIs. */
export async function readBoundedSelectedTextInput(
  stream: AsyncIterable<Uint8Array>, invalid: () => Error
): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.byteLength;
    if (length > CLOUD_ANALYSIS_LIMITS.requestBytes) throw invalid();
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw invalid(); }
}
