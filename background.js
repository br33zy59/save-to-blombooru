const toolbarAction = browser.action || browser.browserAction;

const BADGE_CLEAR_MS = 2500;
const BADGE_SUCCESS = "✓";
const BADGE_FAILURE = "X";
const BADGE_UPLOAD_FRAMES = [".", "..", "..."];
const BADGE_UPLOAD_INTERVAL_MS = 400;

let activeUploadCount = 0;
let badgeClearTimeout = null;
let badgeActivityInterval = null;

function setToolbarBadge(text, color) {
  toolbarAction.setBadgeText({ text });
  if (color) {
    toolbarAction.setBadgeBackgroundColor({ color });
  }
}

function clearToolbarBadgeSoon() {
  if (badgeClearTimeout) {
    clearTimeout(badgeClearTimeout);
  }

  badgeClearTimeout = setTimeout(() => {
    badgeClearTimeout = null;
    if (activeUploadCount === 0) {
      toolbarAction.setBadgeText({ text: "" });
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

async function runInTab(tabId, func, args) {
  if (browser.scripting?.executeScript) {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func,
      args
    });
    return results?.[0]?.result;
  }

  const results = await browser.tabs.executeScript(tabId, {
    func,
    args
  });
  return results?.[0];
}

async function captureMediaCaption(tabId, srcUrl) {
  if (tabId < 0 || !srcUrl) {
    return "";
  }

  try {
    return (await runInTab(tabId, extractMediaCaptionInPage, [srcUrl])) ?? "";
  } catch (e) {
    return "";
  }
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

async function acquireMediaBlobFromTab(tabId, srcUrl) {
  const payload = await runInTab(tabId, extractMediaBlobInPage, [srcUrl]);

  if (!payload?.base64) {
    return null;
  }

  return base64ToBlob(payload.base64, payload.mimeType);
}

async function fetchMediaBlob(srcUrl, requestPermission) {
  const originPattern = originPatternFromUrl(srcUrl);
  const hasPermission = await ensureHostPermission(originPattern, requestPermission);

  if (!hasPermission) {
    return null;
  }

  const response = await fetch(srcUrl);

  if (!response.ok) {
    throw new Error(
      browser.i18n.getMessage("errorDownloadFailed", String(response.status))
    );
  }

  return response.blob();
}

async function resolveMediaBlob(tabId, srcUrl, requestPermission) {
  if (hasInstallTimeBroadHostAccess()) {
    return fetchMediaBlob(srcUrl, false);
  }

  if (tabId >= 0) {
    try {
      const blob = await acquireMediaBlobFromTab(tabId, srcUrl);
      if (blob) {
        return blob;
      }
    } catch (e) {
      // Fall through to optional host permission + fetch.
    }
  }

  const blob = await fetchMediaBlob(srcUrl, requestPermission);
  if (blob) {
    return blob;
  }

  throw new Error(browser.i18n.getMessage("errorDownloadFailed", "0"));
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

  const booruOriginPattern = originPatternFromUrl(server.booruUrl);
  const hasBooruAccess = await ensureHostPermission(booruOriginPattern, true);

  if (!hasBooruAccess) {
    browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icon.png"),
      title: browser.i18n.getMessage("notificationUploadFailedTitle"),
      message: browser.i18n.getMessage("errorUploadHostPermission")
    });
    return;
  }

  const filename = info.srcUrl.split("/").pop() || "upload.bin";
  const caption = await captureMediaCaption(info.tabId, info.srcUrl);
  const description = buildUploadDescription(caption);

  let mediaBlob;
  try {
    mediaBlob = await resolveMediaBlob(info.tabId, info.srcUrl, true);
  } catch (err) {
    browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icon.png"),
      title: browser.i18n.getMessage("notificationUploadFailedTitle"),
      message: err.message
    });
    return;
  }

  performUpload({
    mediaBlob,
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

async function resolvePageUrlForMenus(pageUrl) {
  if (pageUrl) {
    return pageUrl;
  }

  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  return activeTab?.url ?? null;
}

async function updateContextMenus(pageUrl = null) {
  const resolvedPageUrl = await resolvePageUrlForMenus(pageUrl);
  const servers = getConfiguredServers(await getServersFromStorage());

  await browser.contextMenus.removeAll();

  for (const server of servers) {
    if (resolvedPageUrl && isSameServerOrigin(resolvedPageUrl, server.booruUrl)) {
      continue;
    }

    browser.contextMenus.create({
      id: server.id,
      title: getMenuTitle(server, servers),
      contexts: ["image", "video"]
    });
  }
}

async function syncContextMenuVisibilityForPageUrl(pageUrl) {
  await updateContextMenus(pageUrl);
}

async function syncContextMenuVisibilityForTab(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    await updateContextMenus(tab.url);
  } catch (e) {
    // Tab may have been closed.
  }
}

async function syncContextMenuVisibilityForActiveTab() {
  await updateContextMenus();
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

if (browser.windows?.onFocusChanged) {
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
}

function uploadErrorMessage(status, bodyText) {
  if (status === 401) {
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

    if (!data.mediaBlob) {
      throw new Error(browser.i18n.getMessage("errorDownloadFailed", "0"));
    }

    const blob = data.mediaBlob;
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
      iconUrl: browser.runtime.getURL("icon.png"),
      title: browser.i18n.getMessage("notificationUploadFailedTitle"),
      message: err.message
    });
  }
}

updateContextMenus();
