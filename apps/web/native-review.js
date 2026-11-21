// Compare a portable native journal event with the digest the owner copied separately.
(() => {
  const fileInput = document.getElementById("native-review-file");
  const hashInput = document.getElementById("native-review-hash");
  const result = document.getElementById("native-review-result");
  const status = document.getElementById("native-review-status");
  let generation = 0;
  let checked = null;

  function clear() {
    generation++;
    checked = null;
    result.hidden = true;
    document.getElementById("native-review-output").textContent = "";
    document.getElementById("native-review-metadata").textContent = "";
    status.textContent = "";
  }

  fileInput.addEventListener("change", clear);
  hashInput.addEventListener("input", clear);
  document.getElementById("native-review-form").addEventListener("submit", async event => {
    event.preventDefault();
    clear();
    const current = generation;
    const expected = hashInput.value.trim().toLowerCase();
    const file = fileInput.files[0];
    try {
      if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error("Paste the 64-character event digest from the app.");
      if (!file || file.size > 2 * 1024 * 1024) throw new Error("Select an evaluation file of 2 MiB or less.");
      const packet = JSON.parse(await file.text());
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const hash = /^[0-9a-f]{64}$/;
      if (packet?.format !== "pocket-ai-lab.evaluation-attempt.v1" ||
          !Number.isSafeInteger(packet.sequence) || packet.sequence < 1 ||
          !uuid.test(packet.eventID) || typeof packet.payloadJSON !== "string" ||
          !(packet.sequence === 1 ? packet.previousHash === "GENESIS" : hash.test(packet.previousHash))) {
        throw new Error("This file does not contain a supported evaluation event.");
      }
      const material = [packet.sequence, packet.eventID, packet.previousHash, packet.payloadJSON].join("\n");
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
      const actual = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
      if (actual !== expected || actual !== packet.eventHash) {
        throw new Error("The file does not match the digest you supplied.");
      }
      const payload = JSON.parse(packet.payloadJSON);
      const attempt = payload?.attempt;
      const labels = [attempt?.caseID, attempt?.modelID, attempt?.providerKind, attempt?.status];
      if (payload?.kind !== "attempt" || labels.some(label =>
          typeof label !== "string" || !label.trim() || label.length > 512) || typeof attempt?.output !== "string") {
        throw new Error("This record does not contain a readable evaluation attempt.");
      }
      if (current !== generation) return;
      const metadata = "Case: " + attempt.caseID + "\nModel: " + attempt.modelID +
        "\nReported provider: " + attempt.providerKind + "\nReported status: " + attempt.status;
      checked = { digest: actual, metadata };
      document.getElementById("native-review-metadata").textContent = metadata;
      document.getElementById("native-review-output").textContent = attempt.output || "(empty output)";
      result.hidden = false;
      status.textContent = "The bytes match the supplied event digest. Hardware and authorship need separate evidence.";
    } catch (error) {
      if (current === generation) status.textContent = error instanceof SyntaxError ? "Invalid evaluation JSON." : error.message;
    }
  });

  document.getElementById("native-to-memory").addEventListener("click", () => {
    if (!checked) return;
    prepareReviewNote("Native evaluation review\n" + checked.metadata +
      "\nEvent SHA-256: " + checked.digest + "\nCompared with the separately supplied digest.",
      "urn:sha256:" + checked.digest, status);
  });
})();
