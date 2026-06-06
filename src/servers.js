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

function getServerMenuTitle(server, configuredServers, variant = "default") {
  const name = (server.serverName || "").trim();
  const multiple = configuredServers.length > 1;

  const keys =
    variant === "full"
      ? {
          withName: "contextMenuFullWithName",
          withHost: "contextMenuFullWithHost",
          base: "contextMenuFullBase"
        }
      : variant === "thumbnail"
        ? {
            withName: "contextMenuThumbnailWithName",
            withHost: "contextMenuThumbnailWithHost",
            base: "contextMenuThumbnailBase"
          }
        : {
            withName: "contextMenuWithName",
            withHost: "contextMenuWithHost",
            base: "contextMenuBase"
          };

  if (name) {
    return browser.i18n.getMessage(keys.withName, name);
  }

  if (!multiple) {
    return browser.i18n.getMessage(keys.base);
  }

  try {
    const host = new URL(server.booruUrl).host;
    return browser.i18n.getMessage(keys.withHost, host);
  } catch (e) {
    return browser.i18n.getMessage(keys.base);
  }
}

const CONTEXT_MENU_FULL_SUFFIX = ":full";

function getContextMenuFullItemId(serverId) {
  return `${serverId}${CONTEXT_MENU_FULL_SUFFIX}`;
}

function parseContextMenuItemId(menuItemId) {
  if (menuItemId.endsWith(CONTEXT_MENU_FULL_SUFFIX)) {
    return {
      serverId: menuItemId.slice(0, -CONTEXT_MENU_FULL_SUFFIX.length),
      variant: "full"
    };
  }

  return { serverId: menuItemId, variant: "display" };
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
