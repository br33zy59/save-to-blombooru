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
// Each item uses srcUrl only — the URL shown in the grid (poster for video when present).
// Upload targets match Blombooru: JPG, PNG, WEBP, GIF, MP4, WEBM.
function enumeratePageMediaInPage() {
  const BOORU_VIDEO_EXT_RE = /\.(mp4|webm)(\?|$)/i;
  const BOORU_ANIMATED_IMAGE_EXT_RE = /\.gif(\?|$)/i;
  const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|$)/i;

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
      return BOORU_VIDEO_EXT_RE.test(path) || IMAGE_EXT_RE.test(path);
    } catch (e) {
      return false;
    }
  }

  function looksLikeDirectImageUrl(href) {
    if (/^data:image\//i.test(href)) {
      return true;
    }

    try {
      return IMAGE_EXT_RE.test(new URL(href).pathname);
    } catch (e) {
      return false;
    }
  }

  function looksLikeDirectVideoUrl(href) {
    if (/^data:video\//i.test(href)) {
      return true;
    }

    try {
      return BOORU_VIDEO_EXT_RE.test(new URL(href).pathname);
    } catch (e) {
      return false;
    }
  }

  function looksLikeDirectAnimatedImageUrl(href) {
    try {
      return BOORU_ANIMATED_IMAGE_EXT_RE.test(new URL(href).pathname);
    } catch (e) {
      return false;
    }
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

  function kindForUrl(srcUrl) {
    if (looksLikeDirectVideoUrl(srcUrl)) {
      return "video";
    }

    if (looksLikeDirectAnimatedImageUrl(srcUrl)) {
      return "animated";
    }

    return "image";
  }

  function videoStreamUrl(video) {
    const consider = (value) => {
      const href = normalizeMediaUrl(value);

      if (href && isUsableMediaUrl(href) && looksLikeDirectVideoUrl(href)) {
        return href;
      }

      return null;
    };

    return (
      consider(video.currentSrc) ||
      consider(video.src) ||
      [...video.querySelectorAll("source")]
        .map((source) => consider(source.src))
        .find(Boolean) ||
      null
    );
  }

  function videoPosterUrl(video) {
    const poster = normalizeMediaUrl(video.poster);

    if (poster && isUsableMediaUrl(poster) && looksLikeDirectImageUrl(poster)) {
      return poster;
    }

    return null;
  }

  function buildImageItem(img) {
    const srcUrl = normalizeMediaUrl(img.currentSrc || img.src);

    if (!srcUrl || !isUsableMediaUrl(srcUrl)) {
      return null;
    }

    return {
      srcUrl,
      kind: kindForUrl(srcUrl),
      filename: filenameFromUrl(srcUrl),
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
    const posterUrl = videoPosterUrl(video);
    const streamUrl = videoStreamUrl(video);
    const srcUrl = posterUrl || streamUrl;

    if (!srcUrl || !isUsableMediaUrl(srcUrl)) {
      return null;
    }

    return {
      srcUrl,
      kind: "video",
      filename: filenameFromUrl(streamUrl || srcUrl),
      intrinsicWidth: video.videoWidth || video.width || 0,
      intrinsicHeight: video.videoHeight || video.height || 0
    };
  }

  const items = [];
  const seen = new Set();
  let documentOrder = 0;

  function addItem(item) {
    if (!item || seen.has(item.srcUrl)) {
      return;
    }

    seen.add(item.srcUrl);
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
