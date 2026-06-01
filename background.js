console.log("=== Blombooru Uploader (MV3) LOADED ===");

const BADGE_CLEAR_MS = 2500;
const BADGE_SUCCESS = "✓";
const BADGE_FAILURE = "X";
const BADGE_UPLOAD_FRAMES = [".", "..", "..."];
const BADGE_UPLOAD_INTERVAL_MS = 400;

let activeUploadCount = 0;
let badgeClearTimeout = null;
let badgeActivityInterval = null;

function setToolbarBadge(text, color) {
  browser.browserAction.setBadgeText({ text });
  if (color) {
    browser.browserAction.setBadgeBackgroundColor({ color });
  }
}

function clearToolbarBadgeSoon() {
  if (badgeClearTimeout) {
    clearTimeout(badgeClearTimeout);
  }

  badgeClearTimeout = setTimeout(() => {
    badgeClearTimeout = null;
    if (activeUploadCount === 0) {
      browser.browserAction.setBadgeText({ text: "" });
    }
  }, BADGE_CLEAR_MS);
}

function stopUploadingBadgeAnimation() {
  if (badgeActivityInterval) {
    clearInterval(badgeActivityInterval);
    badgeActivityInterval = null;
  }
}

function startUploadingBadge() {
  activeUploadCount += 1;

  if (badgeClearTimeout) {
    clearTimeout(badgeClearTimeout);
    badgeClearTimeout = null;
  }

  if (badgeActivityInterval) {
    return;
  }

  let frame = 0;
  setToolbarBadge(BADGE_UPLOAD_FRAMES[0], "#2563eb");
  badgeActivityInterval = setInterval(() => {
    if (activeUploadCount === 0) {
      stopUploadingBadgeAnimation();
      return;
    }

    frame = (frame + 1) % BADGE_UPLOAD_FRAMES.length;
    setToolbarBadge(BADGE_UPLOAD_FRAMES[frame], "#2563eb");
  }, BADGE_UPLOAD_INTERVAL_MS);
}

function finishUpload(outcome) {
  activeUploadCount = Math.max(0, activeUploadCount - 1);

  if (activeUploadCount > 0) {
    return;
  }

  stopUploadingBadgeAnimation();

  if (outcome === "success") {
    setToolbarBadge(BADGE_SUCCESS, "#16a34a");
  } else if (outcome === "failure") {
    setToolbarBadge(BADGE_FAILURE, "#dc2626");
  }

  clearToolbarBadgeSoon();
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

function formatCapturedOn() {
  const formatted = new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  });

  return `Captured on: ${formatted}`;
}

function buildUploadDescription(captionText) {
  const capturedLine = formatCapturedOn();
  const caption = (captionText || "").trim();

  if (caption) {
    return `${caption}\n\n${capturedLine}`;
  }

  return capturedLine;
}

async function captureMediaCaption(tabId, srcUrl) {
  if (tabId < 0 || !srcUrl) {
    return "";
  }

  try {
    const results = await browser.tabs.executeScript(tabId, {
      func: extractMediaCaptionInPage,
      args: [srcUrl]
    });
    return results?.[0] || "";
  } catch (e) {
    return "";
  }
}

function getConfiguredServers(servers) {
  return (servers || []).filter((entry) => entry && entry.id && entry.booruUrl);
}

function getMenuTitle(server, configuredServers) {
  const name = (server.serverName || "").trim();

  if (name) {
    return browser.i18n.getMessage("contextMenuWithName", name);
  }

  if (configuredServers.length <= 1) {
    return browser.i18n.getMessage("contextMenuBase");
  }

  try {
    const host = new URL(server.booruUrl).host;
    return browser.i18n.getMessage("contextMenuWithHost", host);
  } catch (e) {
    return browser.i18n.getMessage("contextMenuBase");
  }
}

browser.contextMenus.onClicked.addListener(async (info) => {
  const servers = await getServersFromStorage();
  const server = findServerById(servers, info.menuItemId);

  if (!server || !server.booruUrl) {
    return;
  }

  if (isSameServerOrigin(info.pageUrl, server.booruUrl)) {
    return;
  }

  const filename = info.srcUrl.split("/").pop() || "upload.bin";
  const caption = await captureMediaCaption(info.tabId, info.srcUrl);
  const description = buildUploadDescription(caption);

  performUpload({
    srcUrl: info.srcUrl,
    filename,
    source: info.srcUrl,
    description,
    serverId: server.id
  });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    updateContextMenus();
  }
});

async function setContextMenuVisible(menuId, visible) {
  try {
    await browser.contextMenus.update(menuId, { visible });
  } catch (e) {
    // Item may not exist.
  }
}

async function syncContextMenuVisibilityForPageUrl(pageUrl) {
  if (!pageUrl) {
    return;
  }

  const servers = getConfiguredServers(await getServersFromStorage());

  for (const server of servers) {
    await setContextMenuVisible(server.id, !isSameServerOrigin(pageUrl, server.booruUrl));
  }
}

async function syncContextMenuVisibilityForTab(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    await syncContextMenuVisibilityForPageUrl(tab.url);
  } catch (e) {
    // Tab may have been closed.
  }
}

async function syncContextMenuVisibilityForActiveTab() {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  if (activeTab?.url) {
    await syncContextMenuVisibilityForPageUrl(activeTab.url);
  }
}

browser.tabs.onActivated.addListener((activeInfo) => {
  syncContextMenuVisibilityForTab(activeInfo.tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url && changeInfo.status !== "complete") {
    return;
  }

  browser.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
    if (activeTab?.id === tabId) {
      syncContextMenuVisibilityForTab(tabId);
    }
  });
});

browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    return;
  }

  browser.tabs.query({ active: true, windowId }).then(([activeTab]) => {
    if (activeTab?.url) {
      syncContextMenuVisibilityForPageUrl(activeTab.url);
    }
  });
});

async function updateContextMenus() {
  const servers = getConfiguredServers(await getServersFromStorage());

  await browser.contextMenus.removeAll();

  for (const server of servers) {
    browser.contextMenus.create({
      id: server.id,
      title: getMenuTitle(server, servers),
      contexts: ["image", "video"]
    });
  }

  await syncContextMenuVisibilityForActiveTab();
}

function uploadErrorMessage(status, bodyText) {
  if (status === 401 || status === 403) {
    return browser.i18n.getMessage("errorUploadAuthRequired");
  }

  if (status === 405) {
    return browser.i18n.getMessage("errorUploadMethodNotAllowed");
  }

  return browser.i18n.getMessage("errorUploadHttp", [
    String(status),
    String(bodyText ?? "")
  ]);
}

async function performUpload(data) {
  startUploadingBadge();

  try {
    const servers = await getServersFromStorage();
    const server = findServerById(servers, data.serverId);

    if (!server || !server.booruUrl) {
      throw new Error(browser.i18n.getMessage("errorServerNotConfigured"));
    }

    const booruUrl = server.booruUrl.replace(/\/$/, "");
    const apiKey = server.apiKey || "";
    const rating = server.rating;

    const uploadUrl = getMediaUploadUrl(booruUrl);

    const mediaResponse = await fetch(data.srcUrl);

    if (!mediaResponse.ok) {
      throw new Error(
        browser.i18n.getMessage("errorDownloadFailed", String(mediaResponse.status))
      );
    }

    const blob = await mediaResponse.blob();
    const form = new FormData();

    form.append("file", blob, data.filename);
    form.append("rating", rating || "safe");

    if (data.source) {
      form.append("source", data.source);
    }

    const uploadResponse = await authorizedFetch(uploadUrl, apiKey, {
      method: "POST",
      body: form
    });

    if (!uploadResponse.ok) {
      const bodyText = await uploadResponse.text();
      throw new Error(uploadErrorMessage(uploadResponse.status, bodyText));
    }

    if (data.description) {
      let uploaded;
      try {
        uploaded = await uploadResponse.json();
      } catch (e) {
        throw new Error(browser.i18n.getMessage("errorInvalidJson"));
      }

      if (uploaded?.id == null) {
        console.warn("Upload succeeded but response had no media id; description not saved.");
      } else {
        const patchResponse = await authorizedFetch(
          getMediaItemUrl(booruUrl, uploaded.id),
          apiKey,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: data.description })
          }
        );

        if (!patchResponse.ok) {
          const bodyText = await patchResponse.text();
          console.warn(
            "Upload succeeded but description could not be saved:",
            patchResponse.status,
            bodyText
          );
        }
      }
    }

    finishUpload("success");
  } catch (err) {
    console.error(err);
    finishUpload("failure");

    browser.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: browser.i18n.getMessage("notificationUploadFailedTitle"),
      message: err.message
    });
  }
}

browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

updateContextMenus();
