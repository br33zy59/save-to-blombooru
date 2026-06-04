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

function normalizeBooruBaseUrl(urlString) {
  return urlString.trim().replace(/\/$/, "");
}

/**
 * One entry per distinct Blombooru origin (same host, different API keys → one link).
 */
function getDistinctBooruInstances(servers) {
  const byOrigin = new Map();

  for (const entry of servers || []) {
    const raw = (entry.booruUrl || "").trim();
    if (!raw) {
      continue;
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch (e) {
      continue;
    }

    const origin = parsed.origin;
    if (byOrigin.has(origin)) {
      continue;
    }

    const friendlyName = (entry.serverName || "").trim();
    byOrigin.set(origin, {
      url: normalizeBooruBaseUrl(raw),
      origin,
      label: friendlyName || parsed.host
    });
  }

  return [...byOrigin.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  );
}
