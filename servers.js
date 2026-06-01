function createServerEntry(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    booruUrl: "",
    serverName: "",
    apiKey: "",
    rating: "safe",
    ...overrides
  };
}

async function getServersFromStorage() {
  const data = await browser.storage.local.get(["servers"]);

  if (!Array.isArray(data.servers)) {
    return [];
  }

  return data.servers.filter((entry) => entry && entry.id);
}

async function saveServersToStorage(servers) {
  await browser.storage.local.set({ servers });
}

function findServerById(servers, serverId) {
  return servers.find((entry) => entry.id === serverId);
}
