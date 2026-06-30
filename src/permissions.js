function isDataMediaUrl(urlString) {
  return typeof urlString === "string" && urlString.startsWith("data:");
}

function isBlobMediaUrl(urlString) {
  return typeof urlString === "string" && urlString.startsWith("blob:");
}

/** data: or blob: URLs — no host origin; bytes come from the page or inline fetch. */
function isInlineMediaUrl(urlString) {
  return isDataMediaUrl(urlString) || isBlobMediaUrl(urlString);
}

const BLOOMBOORU_UPLOAD_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm"
]);

function mimeFromDataUrl(urlString) {
  if (!isDataMediaUrl(urlString)) {
    return "";
  }

  const match = urlString.match(/^data:([^;,]+)/i);

  return match ? match[1].toLowerCase().trim() : "";
}

/** Decode a data: URL without fetch() (large base64 payloads exceed URL limits). */
function parseDataUrlToBlob(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");

  if (commaIndex < 0) {
    throw new Error("invalid data URL");
  }

  const meta = dataUrl.slice(5, commaIndex);
  let payload = dataUrl.slice(commaIndex + 1);
  const mime = normalizeUploadMimeType(mimeFromDataUrl(dataUrl)) || "application/octet-stream";
  const isBase64 = /;base64/i.test(meta);
  let bytes;

  if (isBase64) {
    payload = payload.replace(/\s+/g, "");
    const binary = atob(payload);

    bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload.replace(/\s+/g, "")));
  }

  if (!bytes.length) {
    throw new Error("empty data URL payload");
  }

  return new Blob([bytes], { type: mime });
}

const UPLOAD_SOURCE_MAX_LENGTH = 2048;

/** Page URL for inline media; never send multi-megabyte data:/blob: strings as source. */
function uploadSourceForSave(pageUrl, srcUrl) {
  if (isInlineMediaUrl(srcUrl)) {
    if (
      pageUrl &&
      !isInlineMediaUrl(pageUrl) &&
      pageUrl.length <= UPLOAD_SOURCE_MAX_LENGTH
    ) {
      return pageUrl;
    }

    return "";
  }

  if (!srcUrl || srcUrl.length > UPLOAD_SOURCE_MAX_LENGTH) {
    return "";
  }

  return srcUrl;
}

function normalizeUploadMimeType(mimeType) {
  const mime = (mimeType || "").toLowerCase().split(";")[0].trim();

  if (!mime) {
    return "";
  }

  if (mime === "image/jpg" || mime === "image/pjpeg") {
    return "image/jpeg";
  }

  return mime;
}

function sniffMimeFromBytes(bytes) {
  if (!bytes || bytes.length < 4) {
    return "";
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return "video/mp4";
  }

  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video/webm";
  }

  return "";
}

function isAllowedUploadMime(mimeType) {
  return BLOOMBOORU_UPLOAD_MIMES.has(normalizeUploadMimeType(mimeType));
}

async function convertImageBlobToPng(blob) {
  const bitmap = await createImageBitmap(blob);

  try {
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      return canvas.convertToBlob({ type: "image/png" });
    }
  } finally {
    bitmap.close();
  }

  throw new Error("OffscreenCanvas is not available");
}

/**
 * Ensure inline / untyped blobs use a Blombooru-accepted MIME, filename, and File body.
 */
async function prepareMediaForUpload(mediaBlob, srcUrl) {
  const buffer = await mediaBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let mime = normalizeUploadMimeType(mediaBlob.type);

  if ((!mime || mime === "application/octet-stream") && isDataMediaUrl(srcUrl)) {
    mime = normalizeUploadMimeType(mimeFromDataUrl(srcUrl));
  }

  if (!mime || mime === "application/octet-stream") {
    mime = normalizeUploadMimeType(sniffMimeFromBytes(bytes));
  }

  let body = bytes;

  if (!isAllowedUploadMime(mime)) {
    const sniffed = sniffMimeFromBytes(bytes);
    const canConvert =
      (mime && mime.startsWith("image/")) ||
      sniffed.startsWith("image/") ||
      isDataMediaUrl(srcUrl) ||
      isBlobMediaUrl(srcUrl);

    if (canConvert) {
      try {
        const sourceBlob = new Blob([body], {
          type: mime || sniffed || mediaBlob.type || "application/octet-stream"
        });
        const pngBlob = await convertImageBlobToPng(sourceBlob);
        body = new Uint8Array(await pngBlob.arrayBuffer());
        mime = "image/png";
      } catch (err) {
        console.warn("Image conversion to PNG failed:", err);
        throw new Error("unsupported");
      }
    } else {
      throw new Error("unsupported");
    }
  }

  const filename = filenameFromMediaUrl(srcUrl, { type: mime });
  const file = new File([body], filename, { type: mime });

  return { mediaBlob: file, filename };
}

function extensionFromMimeType(mimeType) {
  const mime = normalizeUploadMimeType(mimeType);
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm"
  };

  if (map[mime]) {
    return map[mime];
  }

  const sub = mime.split("/")[1];

  if (!sub) {
    return "";
  }

  const base = sub.split("+")[0];

  return base === "jpeg" ? "jpg" : base.replace(/[^a-z0-9]/gi, "");
}

function filenameFromMediaUrl(srcUrl, blob) {
  if (isInlineMediaUrl(srcUrl)) {
    let mime = blob?.type || "";

    if (!mime && isDataMediaUrl(srcUrl)) {
      mime = mimeFromDataUrl(srcUrl);
    }

    const ext = extensionFromMimeType(mime);

    return ext ? `upload.${ext}` : "upload.bin";
  }

  const tail = srcUrl.split("/").pop() || "";
  const query = tail.indexOf("?");

  if (query >= 0) {
    const stripped = tail.slice(0, query).trim();

    return stripped || "upload.bin";
  }

  return tail.trim() || "upload.bin";
}

/** Ensure a Blombooru base URL has an explicit http(s) scheme for validation and storage. */
function normalizeBooruUrlInput(urlString) {
  const trimmed = String(urlString || "").trim();

  if (!trimmed) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function adminUrlFromBooruUrl(booruUrl) {
  const normalized = normalizeBooruUrlInput(booruUrl);

  if (!normalized) {
    return "";
  }

  return `${normalized.replace(/\/+$/, "")}/admin`;
}

function originPatternFromUrl(urlString) {
  if (!urlString || isInlineMediaUrl(urlString)) {
    return null;
  }

  const { origin } = new URL(urlString);

  if (!origin || origin === "null") {
    return null;
  }

  return `${origin}/*`;
}

/** True only for legacy builds that declared <all_urls> at install (pre-MV3 Firefox). */
function hasInstallTimeBroadHostAccess() {
  const manifest = browser.runtime.getManifest();

  if (manifest.host_permissions?.includes("<all_urls>")) {
    return true;
  }

  return (manifest.permissions || []).includes("<all_urls>");
}

function originsAreSame(urlA, urlB) {
  if (!urlA || !urlB) {
    return false;
  }

  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch (err) {
    return false;
  }
}

/**
 * Whether optional host permission must be requested before fetching media bytes.
 * Remote / non-display URLs need host access. On-page display URLs are read via
 * activeTab first; host permission is requested only if that fails.
 */
function shouldPromptForMediaHostPermission(srcUrl, pageUrl) {
  if (hasInstallTimeBroadHostAccess() || !srcUrl) {
    return false;
  }

  if (isInlineMediaUrl(srcUrl)) {
    return false;
  }

  if (pageUrl && originsAreSame(srcUrl, pageUrl)) {
    return false;
  }

  return true;
}

/**
 * After activeTab scripting fails to return bytes, whether host permission is needed
 * for a background fetch (call beginHostPermissionRequests in the same user-gesture turn).
 */
function needsMediaHostPermissionPrompt(srcUrl, pageUrl, tabPayload) {
  if (hasInstallTimeBroadHostAccess() || !srcUrl) {
    return false;
  }

  if (tabPayloadMatchesSrcUrl(tabPayload, srcUrl)) {
    return false;
  }

  if (isInlineMediaUrl(srcUrl)) {
    return false;
  }

  if (pageUrl && originsAreSame(srcUrl, pageUrl)) {
    return true;
  }

  return shouldPromptForMediaHostPermission(srcUrl, pageUrl);
}

function mediaHostPermissionPatternsForUrl(srcUrl) {
  if (!srcUrl || isInlineMediaUrl(srcUrl)) {
    return [];
  }

  try {
    const pattern = originPatternFromUrl(srcUrl);

    return pattern ? [pattern] : [];
  } catch (err) {
    return [];
  }
}

async function ensureHostPermission(originPattern, requestIfNeeded) {
  const hasPermission = await browser.permissions.contains({
    origins: [originPattern]
  });

  if (hasPermission) {
    return true;
  }

  if (!requestIfNeeded) {
    return false;
  }

  try {
    return await browser.permissions.request({
      origins: [originPattern]
    });
  } catch (err) {
    console.warn("Host permission request failed:", err);
    return false;
  }
}

/**
 * Start host permission requests synchronously inside a user-gesture handler.
 * Await the returned promises only after calling this (no await before it).
 */
function beginHostPermissionRequests(originPatterns) {
  if (hasInstallTimeBroadHostAccess()) {
    return [];
  }

  const unique = [...new Set(originPatterns.filter(Boolean))];

  return unique.map((pattern) => {
    let requestPromise;

    try {
      requestPromise = browser.permissions.request({ origins: [pattern] });
    } catch (err) {
      console.warn("Host permission request failed:", err);
      return Promise.resolve(false);
    }

    return requestPromise.catch((err) => {
      console.warn("Host permission request failed:", err);
      return false;
    });
  });
}

async function hostPermissionsGrantedForUrl(srcUrl) {
  const patterns = mediaHostPermissionPatternsForUrl(srcUrl);

  if (patterns.length === 0) {
    return true;
  }

  const results = await Promise.all(
    patterns.map((pattern) =>
      browser.permissions.contains({ origins: [pattern] })
    )
  );

  return results.every(Boolean);
}

function hostPermissionHostLabel(srcUrl) {
  try {
    return new URL(srcUrl).hostname;
  } catch (err) {
    return srcUrl;
  }
}

const PENDING_MEDIA_HOST_SAVE_KEY = "pendingMediaHostSave";
const PENDING_UPLOAD_AUTH_KEY = "pendingUploadAuth";

async function persistPendingUploadAuth(pending) {
  await browser.storage.session.set({
    [PENDING_UPLOAD_AUTH_KEY]: {
      ...pending,
      createdAt: pending.createdAt ?? Date.now()
    }
  });
}

async function readPendingUploadAuth() {
  const data = await browser.storage.session.get(PENDING_UPLOAD_AUTH_KEY);

  return data[PENDING_UPLOAD_AUTH_KEY] ?? null;
}

async function clearPendingUploadAuth() {
  await browser.storage.session.remove(PENDING_UPLOAD_AUTH_KEY);
}

async function persistPendingMediaHostSave(pending) {
  await browser.storage.session.set({
    [PENDING_MEDIA_HOST_SAVE_KEY]: {
      ...pending,
      createdAt: pending.createdAt ?? Date.now(),
      booruPermissionsPreGranted: true,
      mediaPermissionsPreGranted: false
    }
  });
}

async function readPendingMediaHostSave() {
  const data = await browser.storage.session.get(PENDING_MEDIA_HOST_SAVE_KEY);

  return data[PENDING_MEDIA_HOST_SAVE_KEY] ?? null;
}

async function clearPendingMediaHostSave() {
  await browser.storage.session.remove(PENDING_MEDIA_HOST_SAVE_KEY);
}

function notifyUploadFailed(message) {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icon.png"),
    title: browser.i18n.getMessage("notificationUploadFailedTitle"),
    message
  });
}

function notifyBooruHostPermissionDenied() {
  notifyUploadFailed(browser.i18n.getMessage("errorUploadHostPermission"));
}

function notifyMediaHostPermissionDenied(srcUrl) {
  const host = hostPermissionHostLabel(srcUrl);

  notifyUploadFailed(browser.i18n.getMessage("errorUploadMediaHostPermission", host));
}

async function awaitHostPermissionRequests(requestPromises) {
  if (!requestPromises || requestPromises.length === 0) {
    return true;
  }

  const results = await Promise.all(requestPromises);
  return results.every(Boolean);
}
