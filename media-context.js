// Injected via tabs.executeScript to read alt/caption text for the clicked media URL.

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
