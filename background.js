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

async function saveMediaToBlombooru({ tabId, pageUrl, srcUrl, serverId }) {
  const servers = await getServersFromStorage();
  const server = findServerById(servers, serverId);

  if (!server || !server.booruUrl) {
    return;
  }

  if (pageUrl && isSameServerOrigin(pageUrl, server.booruUrl)) {
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

  const filename = srcUrl.split("/").pop() || "upload.bin";
  const caption = await captureMediaCaption(tabId, srcUrl);
  const description = buildUploadDescription(caption);

  let mediaBlob;
  try {
    mediaBlob = await resolveMediaBlob(tabId, srcUrl, true);
  } catch (err) {
    browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icon.png"),
      title: browser.i18n.getMessage("notificationUploadFailedTitle"),
      message: err.message
    });
    return;
  }

  await performUpload({
    mediaBlob,
    filename,
    source: srcUrl,
    description,
    serverId: server.id
  });
}

const contextMenuMediaCache = new Map();

function contextMenuMediaCacheKey(tabId, srcUrl) {
  return `${tabId}:${srcUrl}`;
}

async function resolveContextMenuMedia(tabId, srcUrl) {
  if (!srcUrl || tabId < 0) {
    return {
      displayUrl: srcUrl,
      uploadUrl: srcUrl,
      fullUrlAvailable: false
    };
  }

  const cacheKey = contextMenuMediaCacheKey(tabId, srcUrl);
  const cached = contextMenuMediaCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  try {
    const resolved = await runInTab(tabId, enumeratePageMediaInPage, [srcUrl]);

    if (resolved?.displayUrl) {
      contextMenuMediaCache.set(cacheKey, resolved);
      return resolved;
    }
  } catch (e) {
    console.warn("Context menu media resolve failed:", e);
  }

  return {
    displayUrl: srcUrl,
    uploadUrl: srcUrl,
    fullUrlAvailable: false
  };
}

function uploadSrcUrlForContextMenuChoice(resolution, variant, fallbackSrcUrl) {
  if (variant === "full" && resolution.fullUrlAvailable) {
    return resolution.uploadUrl || fallbackSrcUrl;
  }

  return resolution.displayUrl || fallbackSrcUrl;
}

browser.contextMenus.onClicked.addListener(async (info) => {
  const { serverId, variant } = parseContextMenuItemId(info.menuItemId);
  const resolution = await resolveContextMenuMedia(info.tabId, info.srcUrl);

  await saveMediaToBlombooru({
    tabId: info.tabId,
    pageUrl: info.pageUrl,
    srcUrl: uploadSrcUrlForContextMenuChoice(resolution, variant, info.srcUrl),
    serverId
  });
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "saveMediaToBlombooru") {
    return undefined;
  }

  saveMediaToBlombooru(message.payload)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));

  return true;
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
      title: getServerMenuTitle(server, servers, "default"),
      contexts: ["image", "video"]
    });

    browser.contextMenus.create({
      id: getContextMenuFullItemId(server.id),
      title: getServerMenuTitle(server, servers, "full"),
      contexts: ["image", "video"],
      visible: false
    });
  }
}

async function refreshContextMenusForMedia(info, tab) {
  if (!info.srcUrl || tab?.id == null) {
    return;
  }

  const hasMediaContext =
    info.contexts?.includes("image") || info.contexts?.includes("video");

  if (!hasMediaContext) {
    return;
  }

  const resolvedPageUrl = info.pageUrl || tab.url || null;
  const servers = getConfiguredServers(await getServersFromStorage()).filter(
    (server) => !resolvedPageUrl || !isSameServerOrigin(resolvedPageUrl, server.booruUrl)
  );

  const resolution = await resolveContextMenuMedia(tab.id, info.srcUrl);
  const showFullChoice = Boolean(resolution.fullUrlAvailable);
  const displayVariant = showFullChoice ? "thumbnail" : "default";

  for (const server of servers) {
    const fullItemId = getContextMenuFullItemId(server.id);

    try {
      await browser.contextMenus.update(server.id, {
        title: getServerMenuTitle(server, servers, displayVariant),
        visible: true
      });
    } catch (e) {
      // Item may not exist if server was removed mid-menu.
    }

    try {
      await browser.contextMenus.update(fullItemId, {
        title: getServerMenuTitle(server, servers, "full"),
        visible: showFullChoice
      });
    } catch (e) {
      // Hidden full item may not exist yet.
    }
  }

  if (browser.contextMenus.refresh) {
    await browser.contextMenus.refresh();
  }
}

if (browser.contextMenus.onShown) {
  browser.contextMenus.onShown.addListener((info, tab) => {
    refreshContextMenusForMedia(info, tab).catch((err) => {
      console.warn("Context menu refresh failed:", err);
    });
  });
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

function clearContextMenuMediaCacheForTab(tabId) {
  const prefix = `${tabId}:`;

  for (const key of contextMenuMediaCache.keys()) {
    if (key.startsWith(prefix)) {
      contextMenuMediaCache.delete(key);
    }
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    clearContextMenuMediaCacheForTab(tabId);
  }

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
