import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// The bundled register is an exact copy from this agent-coordination commit.
export const registerRevision = "a13f2314652f5243296acf8d8c4d74e0349eda1b";
const registerFile = new URL("../../docs/research/project-sources.json", import.meta.url);
const stopWords = new Set("a an and are as at be by can did do does for from how i in is it of on or the to was what when which who why with would".split(" "));

function decisionRecord(decision) {
  const byVersion = new Map();
  const successor = new Map();
  for (const revision of decision.revisions) {
    if (!revision.version || byVersion.has(revision.version)) throw Error("Duplicate or empty decision version");
    byVersion.set(revision.version, revision);
    if (revision.supersedes !== undefined) {
      if (successor.has(revision.supersedes)) throw Error("Conflicting decision revisions");
      successor.set(revision.supersedes, revision.version);
    }
  }
  const tips = [...byVersion.keys()].filter(version => !successor.has(version));
  if (tips.length !== 1) throw Error("Decision requires one current version");
  const history = [];
  let version = tips[0];
  while (version !== undefined) {
    const entry = byVersion.get(version);
    if (!entry || history.length >= byVersion.size) throw Error("Broken decision history");
    history.push(entry);
    version = entry.supersedes;
  }
  if (history.length !== byVersion.size) throw Error("Disconnected decision history");
  const { revisions, ...metadata } = decision;
  return { kind: "decision", ...metadata, current: history[0], earlier: history.slice(1) };
}

export function openProjectSources(register = JSON.parse(readFileSync(registerFile, "utf8"))) {
  const records = new Map();
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED, title, topics, body, tokenize='porter unicode61')");
    const insert = db.prepare("INSERT INTO search(id,title,topics,body) VALUES(?,?,?,?)");
    function add(record, body) {
      if (!record.id || records.has(record.id)) throw Error("Duplicate or empty source ID");
      records.set(record.id, record);
      insert.run(record.id, record.title, record.topics || "", body);
    }
    for (const source of register.sources) {
      add({ kind: "source", ...source }, [source.finding, source.locator, source.projectUse].join(" "));
    }
    for (const decision of register.decisions ?? []) {
      const record = decisionRecord(decision);
      add(record, [record.current, ...record.earlier].map(r => r.version + " " + r.finding).join(" "));
    }
    db.exec("PRAGMA query_only = ON");
    const search = db.prepare("SELECT id FROM search WHERE search MATCH ? ORDER BY bm25(search,0,3,4,1), id LIMIT 5");
    const sourceSearch = db.prepare("SELECT id FROM search WHERE search MATCH ? AND id = ?");
    return {
      lookup(value, sourceId) {
        const query = value.trim();
        if (!query) throw RangeError("Enter 1 to 300 characters.");
        // Count Unicode code points, like the source-answer CLI's Python validator.
        let length = 0;
        for (const _ of query) {
          if (++length > 300) throw RangeError("Enter 1 to 300 characters.");
        }
        const selected = sourceId === undefined ? undefined : records.get(sourceId.trim().toUpperCase());
        if (sourceId !== undefined && selected?.kind !== "source") return [];
        const exact = records.get(query.toUpperCase());
        if (exact) return selected && selected.id !== exact.id ? [] : [exact];
        const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
          .filter(word => !stopWords.has(word));
        if (!words.length) return [];
        const match = words.map(word => '"' + word + '"').join(" OR ");
        const rows = selected ? sourceSearch.all(match, selected.id) : search.all(match);
        return rows.map(row => records.get(row.id));
      },
      close() { db.close(); }
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
