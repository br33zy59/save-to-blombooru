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

async function acquireMediaBlobFromTab(tabId, srcUrl) {
  const payload = await probeTabMediaPayload(tabId, srcUrl);

  if (!payload) {
    return null;
  }

  return base64ToBlob(payload.base64, payload.mimeType);
}

function mediaBlobFromTabPayload(tabPayload) {
  if (!tabPayload?.base64) {
    return null;
  }

  return base64ToBlob(tabPayload.base64, tabPayload.mimeType);
}

function fetchDataMediaBlob(srcUrl) {
  try {
    return parseDataUrlToBlob(srcUrl);
  } catch (err) {
    console.warn("Data URL decode failed:", err);
    throw new Error(browser.i18n.getMessage("errorDownloadFailed", "0"));
  }
}

async function fetchMediaBlob(srcUrl, requestPermission) {
  if (isDataMediaUrl(srcUrl)) {
    return fetchDataMediaBlob(srcUrl);
  }

  if (isBlobMediaUrl(srcUrl)) {
    return null;
  }

  const originPattern = originPatternFromUrl(srcUrl);

  if (!originPattern) {
    return null;
  }

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

async function resolveMediaBlob(
  tabId,
  srcUrl,
  requestPermission,
  { tabPayload = null } = {}
) {
  const normalizedTabId = normalizeTabId(tabId);

  if (isDataMediaUrl(srcUrl)) {
    return fetchDataMediaBlob(srcUrl);
  }

  if (hasInstallTimeBroadHostAccess()) {
    return fetchMediaBlob(srcUrl, false);
  }

  let blob = mediaBlobFromTabPayload(tabPayloadForSrcUrl(tabPayload, srcUrl));

  if (!blob && normalizedTabId >= 0) {
    try {
      blob = await acquireMediaBlobFromTab(normalizedTabId, srcUrl);
    } catch (e) {
      // Fall through to optional host permission + fetch.
    }
  }

  blob = blob || (await fetchMediaBlob(srcUrl, requestPermission));

  if (blob) {
    return blob;
  }

  throw new Error(browser.i18n.getMessage("errorDownloadFailed", "0"));
}

const GALLERY_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

async function blobToBase64ForMessage(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

async function dimensionsFromImageBlob(blob) {
  if (typeof createImageBitmap !== "function") {
    return { width: 0, height: 0 };
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch (err) {
    return { width: 0, height: 0 };
  }
}

/** Fetch linked full media for gallery hover preview (no Blombooru upload). */
async function fetchGalleryPreviewMedia({ tabId, srcUrl }) {
  if (!srcUrl) {
    return { ok: false, error: "missing_url" };
  }

  try {
    const blob = await resolveMediaBlob(tabId, srcUrl, false);

    if (!blob) {
      return { ok: false, error: "unavailable" };
    }

    if (blob.size > GALLERY_PREVIEW_MAX_BYTES) {
      return { ok: false, error: "too_large" };
    }

    const mimeType = blob.type || "application/octet-stream";
    let width = 0;
    let height = 0;

    if (mimeType.startsWith("image/")) {
      ({ width, height } = await dimensionsFromImageBlob(blob));
    }

    const base64 = await blobToBase64ForMessage(blob);

    return {
      ok: true,
      mimeType,
      base64,
      width,
      height,
      byteSize: blob.size
    };
  } catch (err) {
    return { ok: false, error: err.message || "fetch_failed" };
  }
}

async function probeMediaByteSize(tabId, srcUrl) {
  if (!srcUrl) {
    return null;
  }

  if (isDataMediaUrl(srcUrl)) {
    try {
      return parseDataUrlToBlob(srcUrl).size;
    } catch (err) {
      return null;
    }
  }

  const normalizedTabId = normalizeTabId(tabId);

  if (isBlobMediaUrl(srcUrl) && normalizedTabId >= 0) {
    const payload = await probeTabMediaPayload(normalizedTabId, srcUrl);

    if (payload?.base64) {
      return base64ToBlob(payload.base64, payload.mimeType).size;
    }

    return null;
  }

  if (!hasInstallTimeBroadHostAccess() && normalizedTabId >= 0) {
    const payload = await probeTabMediaPayload(normalizedTabId, srcUrl);

    if (payload?.base64) {
      return base64ToBlob(payload.base64, payload.mimeType).size;
    }
  }

  let originPattern;

  try {
    originPattern = originPatternFromUrl(srcUrl);
  } catch (err) {
    originPattern = null;
  }

  if (!originPattern) {
    return null;
  }

  const hasPermission = await ensureHostPermission(originPattern, false);

  if (!hasPermission) {
    return null;
  }

  try {
    const headResponse = await fetch(srcUrl, { method: "HEAD" });

    if (headResponse.ok) {
      const contentLength = headResponse.headers.get("Content-Length");

      if (contentLength) {
        const bytes = Number.parseInt(contentLength, 10);

        if (Number.isFinite(bytes) && bytes >= 0) {
          return bytes;
        }
      }
    }
  } catch (err) {
    // Fall through to full fetch.
  }

  try {
    const blob = await fetchMediaBlob(srcUrl, false);

    return blob?.size ?? null;
  } catch (err) {
    return null;
  }
}

async function fetchMediaByteSize({ tabId, srcUrl }) {
  if (!srcUrl) {
    return { ok: false, error: "missing_url" };
  }

  try {
    const byteSize = await probeMediaByteSize(tabId, srcUrl);

    if (byteSize == null || !Number.isFinite(byteSize)) {
      return { ok: false, error: "unavailable" };
    }

    return { ok: true, byteSize };
  } catch (err) {
    return { ok: false, error: err.message || "probe_failed" };
  }
}

async function resumePendingMediaHostSaveIfAny() {
  if (hasInstallTimeBroadHostAccess() || resumingPendingSave) {
    return false;
  }

  const data = await browser.storage.session.get(PENDING_MEDIA_HOST_SAVE_KEY);
  const pending = data[PENDING_MEDIA_HOST_SAVE_KEY];

  if (!pending) {
    return false;
  }

  resumingPendingSave = true;

  try {
    await browser.storage.session.remove(PENDING_MEDIA_HOST_SAVE_KEY);
    await saveMediaToBlombooru({
      ...pending,
      booruPermissionsPreGranted: true,
      mediaPermissionsPreGranted: true
    });
    return true;
  } catch (err) {
    console.warn("Resume pending media-host save failed:", err);
    return false;
  } finally {
    resumingPendingSave = false;
  }
}

function notifySaveNeedsMediaHostPermissionPopupRetry(srcUrl) {
  const host = hostPermissionHostLabel(srcUrl);

  notifyUploadFailed(browser.i18n.getMessage("notifyGrantMediaHostPermissionPopup", host));
}

function isUploadAuthError(err) {
  if (!(err instanceof Error)) {
    return false;
  }

  const msg = err.message;
  return (
    msg === browser.i18n.getMessage("errorUploadAuthRequired") ||
    msg === browser.i18n.getMessage("errorApiKeyRequired")
  );
}

function notifyUploadAuthAdminLoginRequired() {
  notifyUploadFailed(browser.i18n.getMessage("notifyUploadAuthAdminLogin"));
}

function notifyUploadApiKeyRequired() {
  notifyUploadFailed(browser.i18n.getMessage("notifyUploadApiKeyRequired"));
}

async function deferPopupRetry(persist, notify) {
  await persist();
  notify();

  try {
    await browser.action.openPopup();
  } catch (err) {
    console.warn("Could not open extension popup:", err);
  }
}

async function deferUploadAuthPopupRetry({ serverId, booruUrl, authMode = "admin" }) {
  await deferPopupRetry(
    () => persistPendingUploadAuth({ serverId, booruUrl, authMode }),
    authMode === "apiKey"
      ? notifyUploadApiKeyRequired
      : notifyUploadAuthAdminLoginRequired
  );
}

async function deferSaveForMediaHostPermissionPopupRetry({
  tabId,
  pageUrl,
  srcUrl,
  serverId,
  tabPayload
}) {
  await deferPopupRetry(
    () =>
      persistPendingMediaHostSave({
        tabId,
        pageUrl,
        srcUrl,
        serverId,
        tabPayload
      }),
    () => notifySaveNeedsMediaHostPermissionPopupRetry(srcUrl)
  );
}

async function ensureTransferThumbUrl(tabId, srcUrl, thumbUrl) {
  if (thumbUrl && !isVideoPreviewUrl(thumbUrl)) {
    return thumbUrl;
  }

  const normalizedTabId = normalizeTabId(tabId);

  if (normalizedTabId < 0 || !srcUrl) {
    return pickTransferHistoryThumbUrl({ thumbUrl, srcUrl });
  }

  try {
    const resolved = await resolveContextMenuMedia(normalizedTabId, srcUrl, {
      useCache: true
    });

    if (
      resolved?.displayUrl &&
      resolved?.uploadUrl &&
      resolved.displayUrl !== resolved.uploadUrl &&
      !isVideoPreviewUrl(resolved.displayUrl)
    ) {
      return resolved.displayUrl;
    }

    if (resolved?.displayUrl && !isVideoPreviewUrl(resolved.displayUrl)) {
      return resolved.displayUrl;
    }
  } catch (err) {
    console.warn("Transfer thumb resolve failed:", err);
  }

  return pickTransferHistoryThumbUrl({ thumbUrl, srcUrl });
}

async function saveMediaToBlombooru({
  tabId,
  pageUrl,
  srcUrl,
  thumbUrl = null,
  serverId,
  tabPayload = null,
  booruPermissionsPreGranted = false,
  mediaPermissionsPreGranted = false
}) {
  const servers = await getServersFromStorage();
  const server = findServerById(servers, serverId);

  if (!server || !server.booruUrl) {
    throw new Error(browser.i18n.getMessage("errorServerNotConfigured"));
  }

  if (pageUrl && isSameServerOrigin(pageUrl, server.booruUrl)) {
    throw new Error(browser.i18n.getMessage("popupGalleryServerOnPage"));
  }

  const normalizedTabId = normalizeTabId(tabId);
  const resolvedThumbUrl = await ensureTransferThumbUrl(
    normalizedTabId,
    srcUrl,
    thumbUrl
  );

  const transferId = await beginTransferEntry({
    srcUrl,
    thumbUrl: resolvedThumbUrl,
    serverId
  });

  const requestBooruPermission =
    !booruPermissionsPreGranted && !hasInstallTimeBroadHostAccess();
  const requestMediaPermission =
    !mediaPermissionsPreGranted && !hasInstallTimeBroadHostAccess();
  const booruOriginPattern = originPatternFromUrl(server.booruUrl);
  const hasBooruAccess = await ensureHostPermission(
    booruOriginPattern,
    requestBooruPermission
  );

  if (!hasBooruAccess) {
    await finishTransferEntry(
      transferId,
      TRANSFER_STATUS_FAILURE,
      browser.i18n.getMessage("errorUploadHostPermission")
    );
    notifyBooruHostPermissionDenied();
    throw new Error(browser.i18n.getMessage("errorUploadHostPermission"));
  }

  const caption = await captureMediaCaption(normalizedTabId, srcUrl);
  const description = buildUploadDescription(caption);

  let preparedUpload;
  try {
    const mediaBlob = await resolveMediaBlob(
      normalizedTabId,
      srcUrl,
      requestMediaPermission,
      { tabPayload }
    );
    preparedUpload = await prepareMediaForUpload(mediaBlob, srcUrl);
  } catch (err) {
    const message =
      err.message === "unsupported"
        ? browser.i18n.getMessage("errorUnsupportedUploadFormat")
        : err.message;

    await finishTransferEntry(transferId, TRANSFER_STATUS_FAILURE, message);
    notifyUploadFailed(message);
    throw new Error(message);
  }

  const uploadByteSize = preparedUpload.mediaBlob.size;
  await updateTransferEntryByteSize(transferId, uploadByteSize);

  try {
    const uploadResult = await performUpload({
      mediaBlob: preparedUpload.mediaBlob,
      filename: preparedUpload.filename,
      source: uploadSourceForSave(pageUrl, srcUrl),
      description,
      serverId: server.id
    });
    await finishTransferEntry(transferId, TRANSFER_STATUS_SUCCESS, "", {
      mediaPageUrl: uploadResult?.mediaPageUrl || "",
      byteSize: uploadByteSize
    });
  } catch (err) {
    await finishTransferEntry(transferId, TRANSFER_STATUS_FAILURE, err.message, {
      byteSize: uploadByteSize
    });
    throw err;
  }
}

const contextMenuMediaCache = new Map();
let configuredServersForMenus = [];
let resumingPendingSave = false;

function contextMenuMediaCacheKey(tabId, srcUrl) {
  return `${tabId}:${srcUrl}`;
}

function invalidateContextMenuMediaCacheForTab(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  const prefix = `${normalizedTabId}:`;

  for (const key of contextMenuMediaCache.keys()) {
    if (key.startsWith(prefix)) {
      contextMenuMediaCache.delete(key);
    }
  }
}

async function resolveContextMenuMedia(tabId, srcUrl, { useCache = true } = {}) {
  const normalizedTabId = normalizeTabId(tabId);

  if (!srcUrl || normalizedTabId < 0) {
    return {
      displayUrl: srcUrl,
      uploadUrl: srcUrl,
      resolveMethod: "fallback"
    };
  }

  const cacheKey = contextMenuMediaCacheKey(normalizedTabId, srcUrl);
  const cached = useCache ? contextMenuMediaCache.get(cacheKey) : null;

  if (cached) {
    return cached;
  }

  try {
    const resolved = await runInTab(
      normalizedTabId,
      enumeratePageMediaInPage,
      [srcUrl]
    );

    if (resolved?.displayUrl && resolved.resolveMethod != null) {
      contextMenuMediaCache.set(cacheKey, resolved);
      return resolved;
    }

    if (resolved?.displayUrl) {
      return resolved;
    }
  } catch (e) {
    console.warn("Context menu media resolve failed:", e);
  }

  return {
    displayUrl: srcUrl,
    uploadUrl: srcUrl,
    resolveMethod: "fallback"
  };
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = normalizeTabId(info.tabId ?? tab?.id);
  const pageUrl = info.pageUrl || tab?.url || "";
  const { serverId } = parseContextMenuItemId(info.menuItemId);
  const server = findServerById(configuredServersForMenus, serverId);

  let booruRequests = [];

  try {
    const booruPattern = originPatternFromUrl(server.booruUrl);

    if (booruPattern) {
      booruRequests = beginHostPermissionRequests([booruPattern]);
    }
  } catch (e) {
    // Ignore invalid booru URL.
  }

  const booruGranted = await awaitHostPermissionRequests(booruRequests);

  if (!booruGranted) {
    notifyBooruHostPermissionDenied();
    return;
  }

  invalidateContextMenuMediaCacheForTab(tabId);
  const resolution = await resolveContextMenuMedia(tabId, info.srcUrl, {
    useCache: false
  });
  const srcUrl = resolution.uploadUrl || info.srcUrl;
  const thumbUrl = resolution.displayUrl || info.srcUrl;

  const tabPayload =
    tabId >= 0 ? await probeTabMediaPayload(tabId, srcUrl) : null;
  const matchingTabPayload = tabPayloadForSrcUrl(tabPayload, srcUrl);

  if (needsMediaHostPermissionPrompt(srcUrl, pageUrl, tabPayload)) {
    if (!(await hostPermissionsGrantedForUrl(srcUrl))) {
      await deferSaveForMediaHostPermissionPopupRetry({
        tabId,
        pageUrl,
        srcUrl,
        thumbUrl,
        serverId,
        tabPayload: matchingTabPayload
      });
      return;
    }
  }

  await saveMediaToBlombooru({
    tabId,
    pageUrl,
    srcUrl,
    thumbUrl,
    serverId,
    tabPayload: matchingTabPayload,
    booruPermissionsPreGranted: true,
    mediaPermissionsPreGranted: true
  });
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "saveMediaToBlombooru") {
    saveMediaToBlombooru(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  if (message?.type === "fetchGalleryPreviewMedia") {
    fetchGalleryPreviewMedia(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  if (message?.type === "fetchMediaByteSize") {
    fetchMediaByteSize(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  if (message?.type === "galleryMediaHostPermissionSettled") {
    const { granted, srcUrl, serverId, tabId, pageUrl, thumbUrl } = message.payload ?? {};

    (async () => {
      if (!granted) {
        notifyMediaHostPermissionDenied(srcUrl);
        sendResponse({ ok: false });
        return;
      }

      await clearPendingMediaHostSave();
      await saveMediaToBlombooru({
        tabId,
        pageUrl,
        srcUrl,
        thumbUrl: message.payload?.thumbUrl,
        serverId,
        booruPermissionsPreGranted: true,
        mediaPermissionsPreGranted: true
      });
      sendResponse({ ok: true });
    })().catch((err) => {
      console.warn("Gallery save after media host permission failed:", err);
      sendResponse({ ok: false, error: err.message });
    });

    return true;
  }

  if (message?.type === "serversUpdated") {
    scheduleContextMenusUpdate(() => updateContextMenus())
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.warn("Context menu refresh after servers update failed:", err);
        sendResponse({ ok: false, error: err.message });
      });

    return true;
  }

  return undefined;
});

if (browser.permissions.onAdded) {
  browser.permissions.onAdded.addListener(() => {
    void resumePendingMediaHostSaveIfAny();
  });
}

let contextMenusUpdateChain = Promise.resolve();

function scheduleContextMenusUpdate(updateFn) {
  contextMenusUpdateChain = contextMenusUpdateChain.then(updateFn, updateFn);
  return contextMenusUpdateChain;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if (changes.servers) {
    scheduleContextMenusUpdate(() => updateContextMenus());
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
  configuredServersForMenus = servers;

  await browser.contextMenus.removeAll();

  for (const server of servers) {
    if (resolvedPageUrl && isSameServerOrigin(resolvedPageUrl, server.booruUrl)) {
      continue;
    }

    await browser.contextMenus.create({
      id: server.id,
      title: getServerMenuTitle(server, servers),
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
  scheduleContextMenusUpdate(() => syncContextMenuVisibilityForTab(activeInfo.tabId));
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
      scheduleContextMenusUpdate(() => syncContextMenuVisibilityForTab(tabId));
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
        scheduleContextMenusUpdate(() =>
          syncContextMenuVisibilityForPageUrl(activeTab.url)
        );
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

    const source = (data.source || "").trim();

    if (source) {
      form.append("source", source);
    }

    const uploadResponse = await authorizedFetch(uploadUrl, apiKey, {
      method: "POST",
      body: form
    });

    if (!uploadResponse.ok) {
      const bodyText = await uploadResponse.text();

      if (uploadResponse.status === 401) {
        const instanceInfo = await fetchInstanceInfo(booruUrl);

        if (usesApiKeyUploadAuth(instanceInfo)) {
          throw new Error(browser.i18n.getMessage("errorApiKeyRequired"));
        }
      }

      throw new Error(uploadErrorMessage(uploadResponse.status, bodyText));
    }

    let uploaded;
    try {
      uploaded = await uploadResponse.json();
    } catch (e) {
      throw new Error(browser.i18n.getMessage("errorInvalidJson"));
    }

    if (data.description) {
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

    return {
      mediaId: uploaded?.id ?? null,
      mediaPageUrl:
        uploaded?.id != null ? getMediaPageUrl(booruUrl, uploaded.id) : ""
    };
  } catch (err) {
    console.error(err);
    finishUpload("failure");

    if (isUploadAuthError(err)) {
      const servers = await getServersFromStorage();
      const server = findServerById(servers, data.serverId);

      if (server?.booruUrl) {
        const instanceInfo = await fetchInstanceInfo(server.booruUrl);
        const authMode = usesApiKeyUploadAuth(instanceInfo) ? "apiKey" : "admin";

        await deferUploadAuthPopupRetry({
          serverId: data.serverId,
          booruUrl: server.booruUrl,
          authMode
        });
        throw err;
      }
    }

    notifyUploadFailed(err.message);
    throw err;
  }
}

scheduleContextMenusUpdate(() => updateContextMenus());
