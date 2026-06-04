function localizePage(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = browser.i18n.getMessage(el.getAttribute("data-i18n"));
    if (msg) {
      el.textContent = msg;
    }
  });
}

const serverLinksEl = document.getElementById("serverLinks");
const noServersEl = document.getElementById("noServers");

function renderServerLinks(instances) {
  serverLinksEl.replaceChildren();
  serverLinksEl.hidden = instances.length === 0;
  noServersEl.hidden = instances.length > 0;

  for (const instance of instances) {
    const item = document.createElement("li");
    const link = document.createElement("a");

    link.href = instance.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = instance.label;
    link.title = instance.url;

    item.appendChild(link);
    serverLinksEl.appendChild(item);
  }
}

async function refreshPopup() {
  const servers = await getServersFromStorage();
  renderServerLinks(getDistinctBooruInstances(servers));
}

document.getElementById("openSettings").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.servers) {
    refreshPopup();
  }
});

localizePage();
refreshPopup();
