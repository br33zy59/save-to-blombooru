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

/** Partial storage.local update (set merges keys; does not remove other keys). */
async function mergeStorageLocal(updates) {
  const payload = {};
  const keysToRemove = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      keysToRemove.push(key);
    } else {
      payload[key] = value;
    }
  }

  if (keysToRemove.length > 0) {
    await browser.storage.local.remove(keysToRemove);
  }

  if (Object.keys(payload).length > 0) {
    await browser.storage.local.set(payload);
  }
}

async function notifyServersStorageUpdated() {
  try {
    await browser.runtime.sendMessage({ type: "serversUpdated" });
  } catch (err) {
    // Background may be stopped; storage.onChanged still wakes it on Firefox/Chrome.
  }
}

async function saveServersToStorage(servers) {
  await mergeStorageLocal({ servers });
  await notifyServersStorageUpdated();
}

function findServerById(servers, serverId) {
  return servers.find((entry) => entry.id === serverId);
}

function getConfiguredServers(servers) {
  return (servers || []).filter((entry) => entry && entry.id && entry.booruUrl);
}

function getServerOrigin(booruUrl) {
  if (!booruUrl) {
    return null;
  }

  try {
    return new URL(booruUrl.trim()).origin;
  } catch (e) {
    return null;
  }
}

function isSameServerOrigin(pageUrl, booruUrl) {
  const pageOrigin = getServerOrigin(pageUrl);
  const serverOrigin = getServerOrigin(booruUrl);

  if (!pageOrigin || !serverOrigin) {
    return false;
  }

  return pageOrigin === serverOrigin;
}

/** Split configured servers into upload targets vs same-origin as the active page. */
function partitionServersForPage(pageUrl, servers) {
  const configured = getConfiguredServers(servers);
  const available = [];
  const onPage = [];

  for (const server of configured) {
    if (pageUrl && isSameServerOrigin(pageUrl, server.booruUrl)) {
      onPage.push(server);
    } else {
      available.push(server);
    }
  }

  return { configured, available, onPage };
}

function getServerMenuTitle(server, configuredServers) {
  const name = (server.serverName || "").trim();
  const multiple = configuredServers.length > 1;

  if (name) {
    return browser.i18n.getMessage("contextMenuWithName", name);
  }

  if (!multiple) {
    return browser.i18n.getMessage("contextMenuBase");
  }

  try {
    const host = new URL(server.booruUrl).host;
    return browser.i18n.getMessage("contextMenuWithHost", host);
  } catch (e) {
    return browser.i18n.getMessage("contextMenuBase");
  }
}

function parseContextMenuItemId(menuItemId) {
  return { serverId: menuItemId };
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
