import { openProjectSources, registerRevision } from "../../apps/web/project-sources.mjs";

const index = openProjectSources();
try {
  const sources = index.lookup(process.argv[2]).filter(item => item.kind === "source").slice(0, 2);
  console.log(JSON.stringify({ registerRevision, sources: sources.map(({ id, url, finding }) => ({ id, url, finding })) }));
} finally {
  index.close();
}
