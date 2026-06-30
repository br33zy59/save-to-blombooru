// Injected via scripting.executeScript to read alt/caption text for the clicked media URL.

function extractMediaCaptionInPage(srcUrl) {
  function normalizeMediaUrl(url) {
    if (!url) {
      return null;
    }

    try {
      return new URL(url, document.baseURI).href;
    } catch (e) {
      return null;
    }
  }

  function collectElementUrls(el) {
    const urls = new Set();
    const add = (value) => {
      const normalized = normalizeMediaUrl(value);
      if (normalized) {
        urls.add(normalized);
      }
    };

    add(el.src);
    add(el.currentSrc);
    add(el.poster);

    if (el.srcset) {
      for (const part of el.srcset.split(",")) {
        add(part.trim().split(/\s+/)[0]);
      }
    }

    return urls;
  }

  function elementMatchesSrc(el, targetUrl) {
    return collectElementUrls(el).has(targetUrl);
  }

  function findMediaElement(targetUrl) {
    for (const el of document.querySelectorAll("img, video")) {
      if (elementMatchesSrc(el, targetUrl)) {
        return el;
      }
    }

    for (const source of document.querySelectorAll("picture source, video source")) {
      if (elementMatchesSrc(source, targetUrl)) {
        return source.closest("picture, video") || source;
      }
    }

    return null;
  }

  function addUniqueText(parts, seen, value) {
    const text = (value || "").trim().replace(/\s+/g, " ");
    if (!text || seen.has(text)) {
      return;
    }

    seen.add(text);
    parts.push(text);
  }

  const targetUrl = normalizeMediaUrl(srcUrl);
  if (!targetUrl) {
    return "";
  }

  const mediaEl = findMediaElement(targetUrl);
  if (!mediaEl) {
    return "";
  }

  const parts = [];
  const seen = new Set();

  addUniqueText(parts, seen, mediaEl.getAttribute("alt"));
  addUniqueText(parts, seen, mediaEl.getAttribute("title"));
  addUniqueText(parts, seen, mediaEl.getAttribute("aria-label"));

  const figure = mediaEl.closest("figure");
  if (figure) {
    const figcaption = figure.querySelector("figcaption");
    if (figcaption) {
      addUniqueText(parts, seen, figcaption.textContent);
    }
  }

  const captionContainer = mediaEl.closest(
    ".wp-caption, figure, [class*='caption'], [class*='Caption']"
  );
  if (captionContainer) {
    const captionEl = captionContainer.querySelector(
      "figcaption, .wp-caption-text, .caption, [class*='caption-text']"
    );
    if (captionEl) {
      addUniqueText(parts, seen, captionEl.textContent);
    }
  }

  return parts.join("\n");
}

// Injected via scripting API to read media bytes from the page (Chrome activeTab path).
async function extractMediaBlobInPage(srcUrl) {
  function normalizeMediaUrl(url) {
    if (!url) {
      return null;
    }

    try {
      return new URL(url, document.baseURI).href;
    } catch (e) {
      return null;
    }
  }

  function collectElementUrls(el) {
    const urls = new Set();
    const add = (value) => {
      const normalized = normalizeMediaUrl(value);
      if (normalized) {
        urls.add(normalized);
      }
    };

    add(el.src);
    add(el.currentSrc);
    add(el.poster);

    if (el.srcset) {
      for (const part of el.srcset.split(",")) {
        add(part.trim().split(/\s+/)[0]);
      }
    }

    return urls;
  }

  function findMediaElement(targetUrl) {
    for (const el of document.querySelectorAll("img, video")) {
      if (collectElementUrls(el).has(targetUrl)) {
        return el;
      }
    }

    for (const source of document.querySelectorAll("picture source, video source")) {
      if (collectElementUrls(source).has(targetUrl)) {
        return source.closest("picture, video") || source;
      }
    }

    return null;
  }

  async function blobToPayload(blob) {
    if (!blob) {
      return null;
    }

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return {
      base64: btoa(binary),
      mimeType: blob.type || "application/octet-stream"
    };
  }

  function imageElementForMediaNode(mediaEl) {
    if (mediaEl instanceof HTMLImageElement) {
      return mediaEl;
    }

    if (mediaEl instanceof HTMLPictureElement) {
      return mediaEl.querySelector("img");
    }

    if (mediaEl instanceof HTMLSourceElement) {
      return mediaEl.closest("picture")?.querySelector("img") || null;
    }

    return null;
  }

  async function ensureImageReady(img) {
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      return true;
    }

    try {
      await img.decode();
    } catch (e) {
      // decode() rejects for broken images; fall through to loaded check.
    }

    return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  }

  function canvasToBlob(canvas, mimeType) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), mimeType);
    });
  }

  async function blobFromCanvas(canvas, preferType) {
    let blob = await canvasToBlob(canvas, preferType);

    if (!blob && preferType !== "image/png") {
      blob = await canvasToBlob(canvas, "image/png");
    }

    return blob;
  }

  async function blobFromImageElement(img) {
    if (!(await ensureImageReady(img))) {
      return null;
    }

    const outputType = /\.webp(\?|$)/i.test(img.currentSrc || img.src)
      ? "image/webp"
      : "image/png";

    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(img);

        try {
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          bitmap.close();
          return blobFromCanvas(canvas, outputType);
        } catch (e) {
          bitmap.close();
        }
      } catch (e) {
        // Tainted or unsupported — try direct canvas below.
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    try {
      canvas.getContext("2d").drawImage(img, 0, 0);
    } catch (e) {
      return null;
    }

    return blobFromCanvas(canvas, outputType);
  }

  const targetUrl = normalizeMediaUrl(srcUrl);
  if (!targetUrl) {
    return null;
  }

  if (/^data:/i.test(targetUrl)) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) {
        return blobToPayload(await response.blob());
      }
    } catch (e) {
      return null;
    }
  }

  try {
    const response = await fetch(targetUrl);
    if (response.ok) {
      return blobToPayload(await response.blob());
    }
  } catch (e) {
    // Fall through to DOM-based capture.
  }

  const mediaEl = findMediaElement(targetUrl);
  if (!mediaEl) {
    return null;
  }

  const imageEl = imageElementForMediaNode(mediaEl);

  if (imageEl) {
    const blob = await blobFromImageElement(imageEl);

    if (blob) {
      return blobToPayload(blob);
    }
  }

  if (mediaEl instanceof HTMLVideoElement) {
    const fetchUrls = new Set([targetUrl]);

    for (const value of [mediaEl.currentSrc, mediaEl.src]) {
      const normalized = normalizeMediaUrl(value);
      if (normalized) {
        fetchUrls.add(normalized);
      }
    }

    for (const source of mediaEl.querySelectorAll("source")) {
      const normalized = normalizeMediaUrl(source.src);
      if (normalized) {
        fetchUrls.add(normalized);
      }
    }

    for (const url of fetchUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          return blobToPayload(await response.blob());
        }
      } catch (e) {
        // Try next candidate URL.
      }
    }
  }

  return null;
}

// Injected to list images/videos on the page for the toolbar popup gallery.
// Optional lookupSrcUrl: resolve best upload URL for a single right-clicked URL.
// Upload targets match Blombooru: JPG, PNG, WEBP, GIF, MP4, WEBM.
function enumeratePageMediaInPage(lookupSrcUrl) {
  const BOORU_VIDEO_EXT_RE = /\.(mp4|webm)(\?|$)/i;
  const BOORU_ANIMATED_IMAGE_EXT_RE = /\.gif(\?|$)/i;

  const DATA_FULL_ATTRS = [
    "data-src",
    "data-full",
    "data-full-src",
    "data-fullurl",
    "data-full-url",
    "data-original",
    "data-original-src",
    "data-large",
    "data-large-src",
    "data-zoom",
    "data-zoom-image",
    "data-highres",
    "data-hi-res",
    "data-image",
    "data-href"
  ];

  const THUMB_PATH_RE =
    /(?:^|[/_-])(?:thumb|thumbnail|small|preview|mini)(?:[_.-]|$)|[_.-](?:s|xs|sm|md)\.[a-z]+$/i;

  function normalizeMediaUrl(url) {
    if (!url) {
      return null;
    }

    try {
      return new URL(url, document.baseURI).href;
    } catch (e) {
      return null;
    }
  }

  function isUsableMediaUrl(href) {
    if (!href) {
      return false;
    }

    if (/^https?:/i.test(href) || href.startsWith("blob:")) {
      return true;
    }

    if (/^data:image\//i.test(href) || /^data:video\//i.test(href)) {
      return true;
    }

    try {
      const path = new URL(href).pathname;
      return BOORU_VIDEO_EXT_RE.test(path);
    } catch (e) {
      return false;
    }
  }

  function looksLikeDirectImageUrl(href) {
    if (/^data:image\//i.test(href)) {
      return true;
    }

    try {
      const path = new URL(href).pathname;
      return /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|$)/i.test(path);
    } catch (e) {
      return false;
    }
  }

  function looksLikeDirectVideoUrl(href) {
    if (/^data:video\//i.test(href)) {
      return true;
    }

    try {
      const path = new URL(href).pathname;
      return BOORU_VIDEO_EXT_RE.test(path);
    } catch (e) {
      return false;
    }
  }

  function looksLikeDirectAnimatedImageUrl(href) {
    try {
      const path = new URL(href).pathname;
      return BOORU_ANIMATED_IMAGE_EXT_RE.test(path);
    } catch (e) {
      return false;
    }
  }

  function looksLikeUploadableMediaUrl(href) {
    return looksLikeDirectImageUrl(href) || looksLikeDirectVideoUrl(href);
  }

  function filenameFromUrl(href) {
    if (/^data:image\/(\w+)/i.test(href)) {
      const subtype = href.match(/^data:image\/(\w+)/i)[1].toLowerCase();

      return subtype === "jpeg" ? "image.jpg" : `image.${subtype}`;
    }

    if (/^data:video\/(\w+)/i.test(href)) {
      const subtype = href.match(/^data:video\/(\w+)/i)[1].toLowerCase();

      return `video.${subtype}`;
    }

    try {
      const name = new URL(href).pathname.split("/").pop();
      if (name) {
        return decodeURIComponent(name);
      }
    } catch (e) {
      // Ignore.
    }

    return "";
  }

  function urlsShareBasename(urlA, urlB) {
    const baseA = filenameFromUrl(urlA);
    const baseB = filenameFromUrl(urlB);

    return Boolean(
      baseA && baseB && baseA.toLowerCase() === baseB.toLowerCase()
    );
  }

  function pathEndsWithFilename(url, filename) {
    if (!url || !filename) {
      return false;
    }

    try {
      const path = decodeURIComponent(new URL(url).pathname).toLowerCase();
      const base = filename.toLowerCase();

      return path === `/${base}` || path.endsWith(`/${base}`);
    } catch (e) {
      return false;
    }
  }

  function isBareImageFilename(value) {
    const raw = (value || "").trim();

    if (!raw || /[\\/]/.test(raw)) {
      return false;
    }

    return /\.(jpe?g|png|gif|webp|avif|bmp|svg|mp4|webm)(\?.*)?$/i.test(raw);
  }

  /** True when two URLs are the same asset (duplicate lazy-load refs, not thumb vs full). */
  function urlsReferToSameMedia(urlA, urlB) {
    if (!urlA || !urlB) {
      return false;
    }

    if (urlA === urlB) {
      return true;
    }

    try {
      const a = new URL(urlA);
      const b = new URL(urlB);

      if (a.origin === b.origin && a.pathname === b.pathname) {
        return true;
      }

      if (!urlsShareBasename(urlA, urlB)) {
        return false;
      }

      const base = filenameFromUrl(urlA);

      if (a.origin === b.origin) {
        return true;
      }

      // e.g. data-src="190.png" on boards.4chan.org vs src on s.4cdn.org/.../190.png
      if (
        pathEndsWithFilename(urlA, base) &&
        pathEndsWithFilename(urlB, base) &&
        THUMB_PATH_RE.test(urlA) === THUMB_PATH_RE.test(urlB)
      ) {
        return true;
      }
    } catch (e) {
      return false;
    }

    return false;
  }

  function isDataAttrDuplicateReference(displayUrl, dataRef) {
    if (!dataRef?.url) {
      return true;
    }

    const raw = (dataRef.raw ?? "").trim();

    if (isBareImageFilename(raw) && urlsShareBasename(displayUrl, dataRef.url)) {
      return true;
    }

    return urlsReferToSameMedia(displayUrl, dataRef.url);
  }

  function pickLargestSrcset(el) {
    const srcset = el.srcset || el.closest("picture")?.querySelector("source[srcset]")?.srcset;
    if (!srcset) {
      return null;
    }

    let bestUrl = null;
    let bestScore = 0;

    for (const part of srcset.split(",")) {
      const bits = part.trim().split(/\s+/);
      const url = normalizeMediaUrl(bits[0]);
      if (!url || !isUsableMediaUrl(url)) {
        continue;
      }

      let score = 0;
      const descriptor = bits[1] || "";

      if (descriptor.endsWith("w")) {
        score = parseInt(descriptor, 10) || 0;
      } else if (descriptor.endsWith("x")) {
        score = Math.round(parseFloat(descriptor) * 1000) || 0;
      }

      if (!bestUrl || score > bestScore || (score === bestScore && url.length > bestUrl.length)) {
        bestUrl = url;
        bestScore = score;
      }
    }

    if (!bestUrl) {
      return null;
    }

    return { url: bestUrl, score: bestScore };
  }

  function findAnchorMediaUrl(el) {
    const anchor = el.closest("a[href]");
    if (!anchor) {
      return null;
    }

    const href = normalizeMediaUrl(anchor.href);
    if (!href || !isUsableMediaUrl(href) || !looksLikeUploadableMediaUrl(href)) {
      return null;
    }

    return href;
  }

  function findDataAttributeMediaUrl(el) {
    for (const attr of DATA_FULL_ATTRS) {
      const raw = el.getAttribute(attr) || el.closest(`[${attr}]`)?.getAttribute(attr);
      const href = normalizeMediaUrl(raw);
      if (href && isUsableMediaUrl(href) && looksLikeUploadableMediaUrl(href)) {
        return { url: href, raw: raw || "" };
      }
    }

    return null;
  }

  function isHighConfidenceFull(displayUrl, fullUrl, method, img) {
    if (!fullUrl || urlsReferToSameMedia(displayUrl, fullUrl)) {
      return false;
    }

    if (
      looksLikeDirectVideoUrl(fullUrl) &&
      looksLikeDirectImageUrl(displayUrl) &&
      !looksLikeDirectVideoUrl(displayUrl)
    ) {
      return method === "anchor" || method === "data-attr" || method === "video-src";
    }

    if (
      looksLikeDirectAnimatedImageUrl(fullUrl) &&
      looksLikeDirectImageUrl(displayUrl) &&
      (method === "anchor" || method === "data-attr")
    ) {
      return true;
    }

    if (method === "anchor" || method === "data-attr") {
      return true;
    }

    if (method === "video-src") {
      return looksLikeDirectVideoUrl(fullUrl);
    }

    if (method === "srcset") {
      const displayScore = img.naturalWidth || img.width || 0;
      const largest = pickLargestSrcset(img);
      if (largest && largest.score >= Math.max(displayScore * 1.25, 400)) {
        return true;
      }

      if (THUMB_PATH_RE.test(displayUrl) && !THUMB_PATH_RE.test(fullUrl)) {
        return true;
      }

      if (displayScore > 0 && largest?.url === fullUrl) {
        return largest.score >= displayScore * 1.5;
      }

      return Boolean(largest?.score && largest.score >= 400);
    }

    return false;
  }

  function urlFromMediaElement(mediaEl) {
    if (mediaEl instanceof HTMLImageElement) {
      return normalizeMediaUrl(mediaEl.currentSrc || mediaEl.src);
    }

    if (mediaEl instanceof HTMLVideoElement) {
      return getVideoStreamUrl(mediaEl) || normalizeMediaUrl(mediaEl.currentSrc || mediaEl.src);
    }

    return null;
  }

  function hasDistinctUploadUrl(displayUrl, uploadUrl) {
    return Boolean(
      displayUrl && uploadUrl && !urlsReferToSameMedia(displayUrl, uploadUrl)
    );
  }

  /** Anchor-first chain; srcset keeps confidence checks as the last fallback. */
  function resolveBestUploadUrl(el, displayUrl) {
    const anchorUrl = findAnchorMediaUrl(el);
    if (anchorUrl && hasDistinctUploadUrl(displayUrl, anchorUrl)) {
      return { url: anchorUrl, method: "anchor" };
    }

    if (
      el instanceof HTMLImageElement ||
      (el instanceof HTMLVideoElement && isLikelyThumbUrl(displayUrl))
    ) {
      const fullEl = findDynamicFullNearThumb(el, displayUrl);
      if (fullEl) {
        const dynamicUrl = urlFromMediaElement(fullEl);
        if (dynamicUrl && hasDistinctUploadUrl(displayUrl, dynamicUrl)) {
          return { url: dynamicUrl, method: "dynamic-full" };
        }
      }
    }

    const dataRef = findDataAttributeMediaUrl(el);
    if (dataRef && !isDataAttrDuplicateReference(displayUrl, dataRef)) {
      return { url: dataRef.url, method: "data-attr" };
    }

    if (el instanceof HTMLVideoElement) {
      const streamUrl = getVideoStreamUrl(el);
      if (streamUrl && hasDistinctUploadUrl(displayUrl, streamUrl)) {
        return { url: streamUrl, method: "video-src" };
      }
    }

    if (el instanceof HTMLImageElement) {
      const largestSrcset = pickLargestSrcset(el);
      if (
        largestSrcset?.url &&
        hasDistinctUploadUrl(displayUrl, largestSrcset.url) &&
        isHighConfidenceFull(displayUrl, largestSrcset.url, "srcset", el)
      ) {
        return { url: largestSrcset.url, method: "srcset" };
      }
    }

    return null;
  }

  function getVideoStreamUrl(video) {
    const streamUrls = [];

    const consider = (value) => {
      const href = normalizeMediaUrl(value);
      if (href && isUsableMediaUrl(href) && looksLikeDirectVideoUrl(href)) {
        streamUrls.push(href);
      }
    };

    consider(video.currentSrc);
    consider(video.src);

    for (const source of video.querySelectorAll("source")) {
      consider(source.src);
    }

    for (const attr of DATA_FULL_ATTRS) {
      consider(video.getAttribute(attr));
      consider(video.closest(`[${attr}]`)?.getAttribute(attr));
    }

    return [...new Set(streamUrls)][0] ?? null;
  }

  function getVideoPosterUrl(video) {
    const poster = normalizeMediaUrl(video.poster);
    if (poster && isUsableMediaUrl(poster) && looksLikeDirectImageUrl(poster)) {
      return poster;
    }

    const container =
      video.closest("figure, a, [class*='thumb'], [class*='preview'], [class*='poster']") ||
      video.parentElement;

    if (container) {
      for (const img of container.querySelectorAll("img")) {
        if (img === video) {
          continue;
        }

        const href = normalizeMediaUrl(img.currentSrc || img.src);
        if (href && isUsableMediaUrl(href) && looksLikeDirectImageUrl(href)) {
          return href;
        }
      }
    }

    const previous = video.previousElementSibling;
    if (previous instanceof HTMLImageElement) {
      const href = normalizeMediaUrl(previous.currentSrc || previous.src);
      if (href && isUsableMediaUrl(href) && looksLikeDirectImageUrl(href)) {
        return href;
      }
    }

    return null;
  }

  function buildImageItem(img) {
    const displayUrl = normalizeMediaUrl(img.currentSrc || img.src);
    if (!displayUrl || !isUsableMediaUrl(displayUrl)) {
      return null;
    }

    const best = resolveBestUploadUrl(img, displayUrl);
    const uploadUrl = best?.url || displayUrl;
    let kind = looksLikeDirectVideoUrl(uploadUrl) ? "video" : "image";

    if (kind === "image" && looksLikeDirectAnimatedImageUrl(uploadUrl)) {
      kind = "animated";
    }

    return {
      displayUrl,
      uploadUrl,
      resolveMethod: best?.method || "display",
      kind,
      filename: filenameFromUrl(displayUrl),
      intrinsicWidth:
        img.naturalWidth ||
        img.width ||
        parseInt(img.getAttribute("width"), 10) ||
        0,
      intrinsicHeight:
        img.naturalHeight ||
        img.height ||
        parseInt(img.getAttribute("height"), 10) ||
        0
    };
  }

  function buildVideoItem(video) {
    const streamUrl = getVideoStreamUrl(video);
    const posterUrl = getVideoPosterUrl(video);
    const displayUrl = posterUrl || streamUrl;

    if (!displayUrl || !isUsableMediaUrl(displayUrl)) {
      return null;
    }

    const best = resolveBestUploadUrl(video, displayUrl);
    const uploadUrl = best?.url || streamUrl || displayUrl;

    return {
      displayUrl,
      uploadUrl,
      resolveMethod: best?.method || "display",
      kind: "video",
      filename: filenameFromUrl(uploadUrl),
      intrinsicWidth: video.videoWidth || video.width || 0,
      intrinsicHeight: video.videoHeight || video.height || 0
    };
  }

  /** True when two URLs refer to the same resource for right-click lookup. */
  function urlsMatchForLookup(urlA, urlB) {
    if (!urlA || !urlB) {
      return false;
    }

    if (urlA === urlB || urlsReferToSameMedia(urlA, urlB)) {
      return true;
    }

    try {
      const a = new URL(urlA);
      const b = new URL(urlB);

      return (
        a.hostname === b.hostname &&
        a.pathname === b.pathname &&
        a.search === b.search
      );
    } catch (e) {
      return false;
    }
  }

  function collectElementUrls(el) {
    const urls = new Set();
    const add = (value) => {
      const normalized = normalizeMediaUrl(value);
      if (normalized) {
        urls.add(normalized);
      }
    };

    add(el.src);
    add(el.currentSrc);
    add(el.poster);

    if (el.srcset) {
      for (const part of el.srcset.split(",")) {
        add(part.trim().split(/\s+/)[0]);
      }
    }

    for (const attr of DATA_FULL_ATTRS) {
      add(el.getAttribute(attr));
    }

    return urls;
  }

  function elementUrlsMatchTarget(el, targetUrl) {
    for (const url of collectElementUrls(el)) {
      if (urlsMatchForLookup(url, targetUrl)) {
        return true;
      }
    }

    return false;
  }

  function mediaDisplayUrl(media) {
    if (media instanceof HTMLImageElement) {
      return normalizeMediaUrl(media.currentSrc || media.src);
    }

    if (media instanceof HTMLVideoElement) {
      return (
        normalizeMediaUrl(getVideoPosterUrl(media)) ||
        normalizeMediaUrl(getVideoStreamUrl(media))
      );
    }

    return null;
  }

  function isLikelyThumbUrl(url) {
    if (!url) {
      return false;
    }

    if (THUMB_PATH_RE.test(url)) {
      return true;
    }

    try {
      const path = new URL(url).pathname;
      // boards like 4chan: full is 12345.jpg, thumb is 12345s.jpg
      return /s\.(jpe?g|png|gif|webp)$/i.test(path);
    } catch (e) {
      return false;
    }
  }

  function findIhoverFullForThumb(thumbEl, targetUrl) {
    const ihover = document.getElementById("ihover");
    if (!(ihover instanceof HTMLImageElement || ihover instanceof HTMLVideoElement)) {
      return null;
    }

    const ihoverUrl = normalizeMediaUrl(ihover.currentSrc || ihover.src);
    if (!ihoverUrl) {
      return null;
    }

    if (urlsMatchForLookup(ihoverUrl, targetUrl)) {
      return ihover;
    }

    const anchor = thumbEl.closest("a[data-fullid], a.fileThumb, a");
    const postRoot = thumbEl.closest(".post, [id^='p']");
    const fullId =
      anchor?.dataset?.fullID ||
      anchor?.dataset?.fullid ||
      postRoot?.id?.replace(/^p/i, "");

    if (fullId && ihover.dataset?.fullID === fullId) {
      return ihover;
    }

    const anchorUrl = findAnchorMediaUrl(thumbEl);
    if (anchorUrl && urlsMatchForLookup(ihoverUrl, anchorUrl)) {
      return ihover;
    }

    return null;
  }

  /** Full image/video injected beside a thumb (e.g. 4chan X expand or hover). */
  function findDynamicFullNearThumb(thumbEl, targetUrl) {
    const anchor = thumbEl.closest("a.fileThumb, a");

    if (anchor) {
      for (const el of anchor.querySelectorAll(".full-image, video, img")) {
        if (el === thumbEl) {
          continue;
        }

        if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
          return el;
        }
      }

      let next = anchor.nextElementSibling;
      while (next) {
        if (
          next.classList?.contains("full-image") ||
          next instanceof HTMLImageElement ||
          next instanceof HTMLVideoElement
        ) {
          return next;
        }

        next = next.nextElementSibling;
      }
    }

    const fileContainer = thumbEl.closest(".file");
    if (fileContainer) {
      for (const el of fileContainer.querySelectorAll(".full-image, video")) {
        if (el === thumbEl) {
          continue;
        }

        if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
          return el;
        }
      }
    }

    return findIhoverFullForThumb(thumbEl, targetUrl);
  }

  function scoreMediaElementForUrl(el, targetUrl) {
    let score = 0;

    if (el instanceof HTMLVideoElement) {
      score += 16;
    }

    if (el.classList?.contains("full-image")) {
      score += 32;
    }

    if (el.id === "ihover") {
      score += 28;
    }

    const streamUrl =
      el instanceof HTMLVideoElement ? getVideoStreamUrl(el) : null;
    const imageUrl =
      el instanceof HTMLImageElement
        ? normalizeMediaUrl(el.currentSrc || el.src)
        : null;

    if (streamUrl && urlsMatchForLookup(streamUrl, targetUrl)) {
      score += 48;
    }

    if (imageUrl && urlsMatchForLookup(imageUrl, targetUrl)) {
      score += 36;
    }

    if (el.poster && urlsMatchForLookup(el.poster, targetUrl)) {
      score += 4;
    }

    if (looksLikeDirectVideoUrl(targetUrl) && el instanceof HTMLVideoElement) {
      score += 12;
    }

    if (imageUrl && isLikelyThumbUrl(imageUrl)) {
      score -= 8;
    }

    const anchorUrl = findAnchorMediaUrl(el);
    if (anchorUrl) {
      score += 6;

      if (urlsMatchForLookup(anchorUrl, targetUrl)) {
        score += 10;
      }
    }

    const width =
      el instanceof HTMLImageElement
        ? el.naturalWidth || el.width || 0
        : el.videoWidth || el.width || 0;

    if (width > 400) {
      score += 8;
    } else if (width > 200) {
      score += 4;
    }

    return score;
  }

  function resolveMediaElementFromAnchor(targetUrl) {
    const normalized = normalizeMediaUrl(targetUrl);
    if (!normalized) {
      return null;
    }

    for (const anchor of document.querySelectorAll(
      "a.fileThumb[href], a.fileThumb, a[href]"
    )) {
      const href = normalizeMediaUrl(anchor.href);
      const hrefMatches =
        href &&
        looksLikeUploadableMediaUrl(href) &&
        urlsMatchForLookup(href, normalized);

      const thumb = anchor.querySelector("img, video");
      const displayUrl = thumb ? mediaDisplayUrl(thumb) : null;
      const thumbMatches =
        displayUrl && urlsMatchForLookup(displayUrl, normalized);

      if (!hrefMatches && !thumbMatches) {
        continue;
      }

      const fullImage = anchor.querySelector(".full-image, video.full-image");
      if (fullImage instanceof HTMLImageElement || fullImage instanceof HTMLVideoElement) {
        return fullImage;
      }

      if (hrefMatches) {
        const dynamicFull = thumb ? findDynamicFullNearThumb(thumb, normalized) : null;
        if (dynamicFull) {
          return dynamicFull;
        }
      }

      if (thumb) {
        return thumb;
      }
    }

    return null;
  }

  function findMediaElementForUrl(targetUrl) {
    const normalized = normalizeMediaUrl(targetUrl);
    if (!normalized) {
      return null;
    }

    let best = null;
    let bestScore = -1;

    for (const el of document.querySelectorAll("img, video")) {
      if (!elementUrlsMatchTarget(el, normalized)) {
        continue;
      }

      const score = scoreMediaElementForUrl(el, normalized);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) {
      return best;
    }

    for (const source of document.querySelectorAll("picture source, video source")) {
      if (elementUrlsMatchTarget(source, normalized)) {
        return source.closest("picture, video") || source;
      }
    }

    return resolveMediaElementFromAnchor(normalized);
  }

  function itemForMediaElement(el) {
    if (el instanceof HTMLImageElement) {
      return buildImageItem(el);
    }

    if (el instanceof HTMLVideoElement) {
      return buildVideoItem(el);
    }

    return null;
  }

  function resolveForSrc(targetUrl) {
    const normalized = normalizeMediaUrl(targetUrl);
    if (!normalized) {
      return {
        displayUrl: targetUrl,
        uploadUrl: targetUrl,
        resolveMethod: "fallback"
      };
    }

    const el = findMediaElementForUrl(normalized);
    const item = el ? itemForMediaElement(el) : null;

    if (item) {
      return item;
    }

    if (looksLikeUploadableMediaUrl(normalized) && !isLikelyThumbUrl(normalized)) {
      return {
        displayUrl: normalized,
        uploadUrl: normalized,
        resolveMethod: "direct-url"
      };
    }

    const anchorEl = resolveMediaElementFromAnchor(normalized);
    const anchorItem = anchorEl ? itemForMediaElement(anchorEl) : null;

    if (anchorItem) {
      return anchorItem;
    }

    return {
      displayUrl: normalized,
      uploadUrl: normalized,
      resolveMethod: "fallback"
    };
  }

  if (lookupSrcUrl) {
    return resolveForSrc(lookupSrcUrl);
  }

  const items = [];
  const seen = new Set();

  let documentOrder = 0;

  /** True when candidate is the on-page full for a thumb+full gallery entry. */
  function isFoldedFullDuplicate(candidateItem, hostItem) {
    if (
      !hostItem?.uploadUrl ||
      !hasDistinctUploadUrl(hostItem.displayUrl, hostItem.uploadUrl)
    ) {
      return false;
    }

    if (urlsReferToSameMedia(candidateItem.displayUrl, hostItem.uploadUrl)) {
      return true;
    }

    if (
      candidateItem.uploadUrl &&
      urlsReferToSameMedia(candidateItem.uploadUrl, hostItem.uploadUrl)
    ) {
      return true;
    }

    return false;
  }

  function enrichWithFullOnPageMetadata(host, fullCandidate) {
    const fullW = fullCandidate.intrinsicWidth || 0;
    const fullH = fullCandidate.intrinsicHeight || 0;

    if (fullW > 0) {
      host.fullIntrinsicWidth = fullW;
    }

    if (fullH > 0) {
      host.fullIntrinsicHeight = fullH;
    }

    host.fullOnPage = true;
  }

  function addItem(item) {
    if (!item) {
      return;
    }

    for (const existing of items) {
      if (isFoldedFullDuplicate(item, existing)) {
        enrichWithFullOnPageMetadata(existing, item);
        return;
      }
    }

    if (hasDistinctUploadUrl(item.displayUrl, item.uploadUrl)) {
      for (let i = items.length - 1; i >= 0; i--) {
        const existing = items[i];

        if (
          !hasDistinctUploadUrl(existing.displayUrl, existing.uploadUrl) &&
          isFoldedFullDuplicate(existing, item)
        ) {
          enrichWithFullOnPageMetadata(item, existing);
          seen.delete(existing.displayUrl);
          items.splice(i, 1);
        }
      }
    }

    if (seen.has(item.displayUrl)) {
      return;
    }

    seen.add(item.displayUrl);
    item.documentOrder = documentOrder;
    documentOrder += 1;
    items.push(item);
  }

  for (const el of document.querySelectorAll("img, video")) {
    if (el instanceof HTMLImageElement) {
      addItem(buildImageItem(el));
    } else if (el instanceof HTMLVideoElement) {
      addItem(buildVideoItem(el));
    }
  }

  return { items };
}
