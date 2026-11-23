// Navigation only. Cloud-hosted pages never submit data to the local-only APIs.
const sidebar = document.getElementById("sidebar");
const views = [...document.querySelectorAll("section.view")];
const links = [...document.querySelectorAll("[data-view]")];
function showView(name) {
  if (!views.some(view => view.id === name + "-view")) return;
  for (const view of views) view.classList.toggle("hidden", view.id !== name + "-view");
  for (const link of links) link.classList.toggle("active", link.dataset.view === name);
  document.getElementById("page-name").textContent = name[0].toUpperCase() + name.slice(1);
  sidebar.classList.remove("open");
}
for (const link of links) link.addEventListener("click", () => showView(link.dataset.view));
document.getElementById("settings-shortcut").addEventListener("click", () => showView("settings"));
document.getElementById("mobile-menu").addEventListener("click", () => sidebar.classList.toggle("open"));
