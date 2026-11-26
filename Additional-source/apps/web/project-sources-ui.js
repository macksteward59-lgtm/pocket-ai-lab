const form = document.getElementById("source-form");
const query = document.getElementById("source-query");
const status = document.getElementById("source-status");
const results = document.getElementById("source-results");
let latestRequest = 0;

function element(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function citation(label, url) {
  const link = element("a", label);
  link.href = url;
  return link;
}

function render(record) {
  const card = document.createElement("article");
  card.className = "memory-form";
  card.append(element("h2", record.title), element("small", record.id));
  if (record.kind === "source") {
    card.append(element("p", record.finding), citation(record.publisher + " · " + record.locator, record.url));
  } else {
    for (const [index, revision] of [record.current, ...record.earlier].entries()) {
      card.append(element("h3", (index === 0 ? "Current · " : "Earlier · ") + revision.version),
        element("p", revision.finding), citation("View implementation", revision.citation));
      if (revision.test) card.append(element("span", " · "), citation("Test evidence", revision.test));
    }
  }
  return card;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const request = ++latestRequest;
  results.replaceChildren();
  status.textContent = "Searching…";
  try {
    const response = await fetch("/api/project-sources?" + new URLSearchParams({ q: query.value }));
    const data = await response.json();
    if (request !== latestRequest) return;
    if (!response.ok) throw Error(data.error || "Search unavailable.");
    results.replaceChildren(...data.results.map(render));
    status.textContent = data.results.length
      ? "Suggested sources (" + data.results.length + "). Check the cited passage before using it as an answer."
      : "No matching project source.";
  } catch (error) {
    if (request === latestRequest) status.textContent = error.message;
  }
});
