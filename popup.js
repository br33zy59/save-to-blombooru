function localizePage(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = browser.i18n.getMessage(el.getAttribute("data-i18n"));
    if (msg) {
      el.textContent = msg;
    }
  });
}

const serverLinksEl = document.getElementById("serverLinks");
const noServersEl = document.getElementById("noServers");
const pageMediaSection = document.getElementById("pageMediaSection");
const pageMediaStatus = document.getElementById("pageMediaStatus");
const pageMediaHost = document.getElementById("pageMediaHost");
const galleryHoverPreviewPane = document.getElementById("galleryHoverPreviewPane");
const galleryServerMenu = document.getElementById("galleryServerMenu");
const galleryHoverPreview = document.getElementById("galleryHoverPreview");
const galleryHoverPreviewFrame = document.getElementById("galleryHoverPreviewFrame");
const galleryHoverPreviewImg = document.getElementById("galleryHoverPreviewImg");
const galleryHoverPreviewFilename = document.getElementById("galleryHoverPreviewFilename");
const galleryHoverPreviewDimensions = document.getElementById("galleryHoverPreviewDimensions");

/** Reserved left column width (must match CSS .gallery-hover-preview-pane). */
const GALLERY_PREVIEW_PANE_WIDTH = 360;
const GALLERY_PREVIEW_PANE_PADDING = 20;
const GALLERY_PREVIEW_MAX_WIDTH = GALLERY_PREVIEW_PANE_WIDTH - GALLERY_PREVIEW_PANE_PADDING;
const GALLERY_PREVIEW_MAX_HEIGHT = 580;

let gallerySourceTabId = -1;
let galleryPageUrl = "";
let galleryMenuIgnoreDismissUntil = 0;

function renderServerLinks(instances) {
  serverLinksEl.replaceChildren();
  serverLinksEl.hidden = instances.length === 0;
  noServersEl.hidden = instances.length > 0;

  for (const instance of instances) {
    const item = document.createElement("li");
    const link = document.createElement("a");

    link.href = instance.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = instance.label;
    link.title = instance.url;

    item.appendChild(link);
    serverLinksEl.appendChild(item);
  }
}

function isScannableTabUrl(url) {
  if (!url) {
    return false;
  }

  return (
    /^https?:/i.test(url) ||
    url.startsWith("file:") ||
    url.startsWith("ftp:")
  );
}

async function getActiveTab() {
  const [focusedTab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
    windowType: "normal"
  });

  if (focusedTab?.id != null) {
    return focusedTab;
  }

  const [fallbackTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return fallbackTab ?? null;
}

function hideGalleryHoverPreview() {
  galleryHoverPreview.classList.remove("gallery-hover-preview--visible");
  galleryHoverPreview.hidden = true;
  galleryHoverPreview.setAttribute("aria-hidden", "true");
  galleryHoverPreviewPane.setAttribute("aria-hidden", "true");
  galleryHoverPreviewFrame.style.width = "";
  galleryHoverPreviewFrame.style.height = "";
  galleryHoverPreviewFrame.style.minHeight = "";
  galleryHoverPreviewImg.style.width = "";
  galleryHoverPreviewImg.style.height = "";
  galleryHoverPreviewFilename.hidden = true;
  galleryHoverPreviewFilename.textContent = "";
  galleryHoverPreviewDimensions.hidden = true;
  galleryHoverPreviewDimensions.textContent = "";
}

function previewFilenameFromUrl(url) {
  if (!url) {
    return "";
  }

  try {
    const name = new URL(url).pathname.split("/").pop();
    if (name) {
      return decodeURIComponent(name);
    }
  } catch (err) {
    const fallback = url.split("/").pop()?.split("?")[0];
    if (fallback) {
      return decodeURIComponent(fallback);
    }
  }

  return "";
}

function updateGalleryHoverPreviewCaption(
  labelUrl,
  dimensionsUnknown,
  intrinsicWidth,
  intrinsicHeight,
  altText
) {
  const filename = previewFilenameFromUrl(labelUrl) || (altText || "").trim();

  if (filename) {
    galleryHoverPreviewFilename.textContent = filename;
    galleryHoverPreviewFilename.hidden = false;
  } else {
    galleryHoverPreviewFilename.textContent = "";
    galleryHoverPreviewFilename.hidden = true;
  }

  if (dimensionsUnknown) {
    galleryHoverPreviewDimensions.textContent = browser.i18n.getMessage(
      "popupGalleryPreviewDimensionsUnknown"
    );
    galleryHoverPreviewDimensions.hidden = false;
    return;
  }

  const width = galleryHoverPreviewImg.naturalWidth || intrinsicWidth;
  const height = galleryHoverPreviewImg.naturalHeight || intrinsicHeight;

  if (width > 0 && height > 0) {
    galleryHoverPreviewDimensions.textContent = `${width} × ${height}`;
    galleryHoverPreviewDimensions.hidden = false;
  } else {
    galleryHoverPreviewDimensions.textContent = "";
    galleryHoverPreviewDimensions.hidden = true;
  }
}

function computeGalleryPreviewSize(intrinsicWidth, intrinsicHeight, maxWidth, maxHeight) {
  const maxW = Math.min(GALLERY_PREVIEW_MAX_WIDTH, maxWidth);
  const maxH = maxHeight;

  if (intrinsicWidth > 0 && intrinsicHeight > 0) {
    const ratio = intrinsicWidth / intrinsicHeight;
    let height = Math.min(maxH, maxW / ratio);
    let width = height * ratio;

    if (width > maxW) {
      width = maxW;
      height = width / ratio;
    }

    return { width: Math.ceil(width), height: Math.ceil(height) };
  }

  return { width: maxW, height: Math.min(maxH, maxW) };
}

function layoutGalleryHoverPreview(
  intrinsicWidth,
  intrinsicHeight,
  dimensionsUnknown,
  labelUrl,
  altText
) {
  const maxHeight = Math.min(GALLERY_PREVIEW_MAX_HEIGHT, window.innerHeight - 24);
  const aspectW = galleryHoverPreviewImg.naturalWidth || intrinsicWidth;
  const aspectH = galleryHoverPreviewImg.naturalHeight || intrinsicHeight;
  const { width, height } = computeGalleryPreviewSize(
    aspectW,
    aspectH,
    GALLERY_PREVIEW_MAX_WIDTH,
    maxHeight
  );

  galleryHoverPreviewFrame.style.width = `${width}px`;
  galleryHoverPreviewFrame.style.height = `${height}px`;
  galleryHoverPreviewImg.style.width = `${width}px`;
  galleryHoverPreviewImg.style.height = `${height}px`;
  updateGalleryHoverPreviewCaption(
    labelUrl,
    dimensionsUnknown,
    intrinsicWidth,
    intrinsicHeight,
    altText
  );
}

function showGalleryHoverPreview(
  imageUrl,
  altText,
  intrinsicWidth,
  intrinsicHeight,
  dimensionsUnknown,
  labelUrl
) {
  const captionLabelUrl = labelUrl ?? imageUrl;

  galleryHoverPreviewImg.alt = altText || "";
  galleryHoverPreviewImg.classList.remove("gallery-hover-preview__img--broken");
  galleryHoverPreview.hidden = false;
  galleryHoverPreview.setAttribute("aria-hidden", "false");
  galleryHoverPreviewPane.setAttribute("aria-hidden", "false");
  galleryHoverPreview.classList.add("gallery-hover-preview--visible");

  const layout = () => {
    layoutGalleryHoverPreview(
      intrinsicWidth,
      intrinsicHeight,
      dimensionsUnknown,
      captionLabelUrl,
      altText
    );
  };

  if (galleryHoverPreviewImg.src !== imageUrl) {
    galleryHoverPreviewImg.addEventListener("load", layout, { once: true });
    galleryHoverPreviewImg.addEventListener(
      "error",
      () => {
        galleryHoverPreviewImg.classList.add("gallery-hover-preview__img--broken");
        layout();
      },
      { once: true }
    );
    galleryHoverPreviewImg.src = imageUrl;
  } else {
    layout();
  }

  if (galleryHoverPreviewImg.complete) {
    layout();
  }
}

function bindGalleryHoverPreview(
  cell,
  displayUrl,
  altText,
  uploadUrl,
  fullUrlAvailable,
  intrinsicWidth,
  intrinsicHeight
) {
  cell.addEventListener("mouseover", (event) => {
    if (!cell.contains(event.target)) {
      return;
    }

    const hoveringFullTarget = Boolean(event.target.closest(".media-choice-half--full"));
    const labelUrl = fullUrlAvailable && hoveringFullTarget ? uploadUrl : displayUrl;
    const dimensionsUnknown = fullUrlAvailable && hoveringFullTarget;

    showGalleryHoverPreview(
      displayUrl,
      altText,
      intrinsicWidth,
      intrinsicHeight,
      dimensionsUnknown,
      labelUrl
    );
  });
}

function setPageMediaStatus(messageKey) {
  pageMediaStatus.hidden = false;
  pageMediaStatus.textContent = browser.i18n.getMessage(messageKey);
  hideGalleryHoverPreview();
  pageMediaHost.replaceChildren();
}

function clearPageMediaStatus() {
  pageMediaStatus.hidden = true;
  pageMediaStatus.textContent = "";
}

function parkGalleryServerMenu() {
  galleryServerMenu.hidden = true;
  galleryServerMenu.classList.remove("gallery-server-menu--above");
  galleryServerMenu.style.left = "";
  galleryServerMenu.replaceChildren();
  if (galleryServerMenu.parentElement !== document.body) {
    document.body.appendChild(galleryServerMenu);
  }
}

function closeGalleryServerMenu() {
  parkGalleryServerMenu();
  pageMediaHost.querySelectorAll(".media-cell--show-choice").forEach((cell) => {
    cell.classList.remove("media-cell--show-choice");
  });
}

function positionGalleryServerMenu(anchorEl) {
  galleryServerMenu.classList.remove("gallery-server-menu--above");
  galleryServerMenu.style.left = "0";

  const margin = 8;
  const cellRect = anchorEl.getBoundingClientRect();
  const menuHeight = galleryServerMenu.offsetHeight;
  const spaceBelow = window.innerHeight - cellRect.bottom;

  if (spaceBelow < menuHeight + margin && cellRect.top > menuHeight + margin) {
    galleryServerMenu.classList.add("gallery-server-menu--above");
  }

  const menuRect = galleryServerMenu.getBoundingClientRect();
  const overflowRight = menuRect.right - window.innerWidth + margin;

  if (overflowRight > 0) {
    galleryServerMenu.style.left = `${-overflowRight}px`;
  }

  const shiftedRect = galleryServerMenu.getBoundingClientRect();
  const overflowLeft = margin - shiftedRect.left;

  if (overflowLeft > 0) {
    galleryServerMenu.style.left = `${parseFloat(galleryServerMenu.style.left || "0") + overflowLeft}px`;
  }

  galleryServerMenu.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function startGallerySave(srcUrl, serverId) {
  closeGalleryServerMenu();

  try {
    const response = await browser.runtime.sendMessage({
      type: "saveMediaToBlombooru",
      payload: {
        tabId: gallerySourceTabId,
        pageUrl: galleryPageUrl,
        srcUrl,
        serverId
      }
    });

    if (response && !response.ok) {
      console.warn("Gallery save failed:", response.error);
    }
  } catch (err) {
    console.warn("Gallery save message failed:", err);
  }
}

function appendGalleryServerMenuItem(server, configured, { disabled, srcUrl }) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "gallery-server-menu-item";
  item.setAttribute("role", "menuitem");
  item.textContent = getServerMenuTitle(server, configured);
  item.title = disabled
    ? browser.i18n.getMessage("popupGalleryServerOnPage")
    : server.booruUrl;

  if (disabled) {
    item.disabled = true;
    item.classList.add("gallery-server-menu-item--on-page");
    item.setAttribute("aria-disabled", "true");
  } else {
    const serverId = server.id;
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      startGallerySave(srcUrl, serverId);
    });
  }

  galleryServerMenu.appendChild(item);
}

async function openGalleryServerMenu(srcUrl, anchorEl) {
  try {
    const allServers = await getServersFromStorage();
    const { configured, available, onPage } = partitionServersForPage(
      galleryPageUrl,
      allServers
    );

    closeGalleryServerMenu();

    if (configured.length === 0) {
      setPageMediaStatus("popupNoServers");
      return;
    }

    if (available.length === 0 && onPage.length === 0) {
      return;
    }

    clearPageMediaStatus();

    for (const server of available) {
      appendGalleryServerMenuItem(server, configured, { disabled: false, srcUrl });
    }

    for (const server of onPage) {
      appendGalleryServerMenuItem(server, configured, { disabled: true, srcUrl });
    }

    anchorEl.appendChild(galleryServerMenu);
    galleryServerMenu.hidden = false;
    galleryMenuIgnoreDismissUntil = Date.now() + 200;

    requestAnimationFrame(() => {
      positionGalleryServerMenu(anchorEl);
      galleryServerMenu.querySelector(".gallery-server-menu-item")?.focus();
    });
  } catch (err) {
    console.error("openGalleryServerMenu failed:", err);
    setPageMediaStatus("popupPageMediaUnavailable");
  }
}

function bindGallerySaveTrigger(element, srcUrl, anchorEl) {
  let openGuardUntil = 0;

  const openMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (now < openGuardUntil) {
      return;
    }
    openGuardUntil = now + 300;

    void openGalleryServerMenu(srcUrl, anchorEl);
  };

  element.addEventListener("click", openMenu);
  element.addEventListener("pointerup", (event) => {
    if (event.button === 0) {
      openMenu(event);
    }
  });
}

function getPopupChoiceFullLabel(mediaKind) {
  if (mediaKind === "video") {
    return browser.i18n.getMessage("popupChoiceVideo");
  }

  return browser.i18n.getMessage("popupChoiceFull");
}

function createUploadOverlay(cell, displayUrl) {
  const overlay = document.createElement("div");
  overlay.className = "media-choice-overlay media-choice-overlay--single";

  const uploadButton = document.createElement("button");
  uploadButton.type = "button";
  uploadButton.className = "media-choice-single";
  const uploadLabel = browser.i18n.getMessage("popupGalleryUpload");
  uploadButton.title = uploadLabel;
  uploadButton.textContent = uploadLabel;
  bindGallerySaveTrigger(uploadButton, displayUrl, cell);

  overlay.appendChild(uploadButton);
  return overlay;
}

function createSplitChoiceOverlay(cell, displayUrl, uploadUrl, mediaKind) {
  const overlay = document.createElement("div");
  overlay.className = "media-choice-overlay";
  const fullLabel = getPopupChoiceFullLabel(mediaKind);

  const thumbHalf = document.createElement("button");
  thumbHalf.type = "button";
  thumbHalf.className = "media-choice-half media-choice-half--thumb";
  thumbHalf.title = browser.i18n.getMessage("popupChoiceThumbnail");
  thumbHalf.textContent = browser.i18n.getMessage("popupChoiceThumbnail");
  bindGallerySaveTrigger(thumbHalf, displayUrl, cell);

  const divider = document.createElement("div");
  divider.className = "media-choice-divider";
  divider.setAttribute("aria-hidden", "true");

  const fullHalf = document.createElement("button");
  fullHalf.type = "button";
  fullHalf.className = "media-choice-half media-choice-half--full";
  fullHalf.title = fullLabel;
  fullHalf.textContent = fullLabel;
  bindGallerySaveTrigger(fullHalf, uploadUrl, cell);

  overlay.append(thumbHalf, divider, fullHalf);
  return overlay;
}

function renderPageMediaGallery(items) {
  hideGalleryHoverPreview();
  pageMediaHost.replaceChildren();

  if (items.length === 0) {
    setPageMediaStatus("popupNoPageMedia");
    return;
  }

  clearPageMediaStatus();

  const grid = document.createElement("div");
  grid.className = "page-media-grid";
  grid.setAttribute("role", "list");

  for (const item of items) {
    const displayUrl = item.displayUrl || item.srcUrl;
    const uploadUrl = item.uploadUrl || displayUrl;

    const cell = document.createElement("div");
    cell.className = "media-cell";
    cell.setAttribute("role", "listitem");
    cell.dataset.displayUrl = displayUrl;
    cell.dataset.uploadUrl = uploadUrl;
    cell.dataset.mediaKind = item.kind;
    cell.title = displayUrl;

    if (item.fullUrlAvailable) {
      cell.classList.add("media-cell--has-full");
      cell.dataset.fullAvailable = "true";
      cell.addEventListener("click", (event) => {
        if (event.target.closest(".media-choice-half, .media-choice-single")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const wasOpen = cell.classList.contains("media-cell--show-choice");
        pageMediaHost.querySelectorAll(".media-cell--show-choice").forEach((other) => {
          other.classList.remove("media-cell--show-choice");
        });
        if (!wasOpen) {
          cell.classList.add("media-cell--show-choice");
        }
      });
    }

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "media-thumb-wrap";

    const img = document.createElement("img");
    img.className = "media-thumb";
    img.alt = item.filename || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = displayUrl;

    if (item.kind === "video" || item.kind === "animated") {
      img.classList.add("media-thumb--video");
    }

    img.addEventListener("error", () => {
      img.classList.add("media-thumb--broken");
      img.removeAttribute("src");
    });

    thumbWrap.appendChild(img);

    if (item.kind === "video" || item.kind === "animated") {
      const badge = document.createElement("span");
      badge.className = "media-kind-badge";
      badge.textContent = item.kind === "animated" ? "GIF" : "▶";
      badge.setAttribute("aria-hidden", "true");
      thumbWrap.appendChild(badge);
    }

    if (item.fullUrlAvailable) {
      thumbWrap.appendChild(createSplitChoiceOverlay(cell, displayUrl, uploadUrl, item.kind));
    } else {
      thumbWrap.appendChild(createUploadOverlay(cell, displayUrl));
    }

    cell.appendChild(thumbWrap);

    const label = document.createElement("div");
    label.className = "media-filename";
    label.textContent = item.filename || item.kind;
    cell.appendChild(label);

    bindGalleryHoverPreview(
      cell,
      displayUrl,
      item.filename || item.kind,
      uploadUrl,
      item.fullUrlAvailable,
      item.intrinsicWidth ?? 0,
      item.intrinsicHeight ?? 0
    );

    grid.appendChild(cell);
  }

  pageMediaHost.appendChild(grid);
}

function isGalleryPreviewHoverTarget(node) {
  return node instanceof Node && galleryHoverPreviewPane.contains(node);
}

pageMediaHost.addEventListener("mouseleave", (event) => {
  if (isGalleryPreviewHoverTarget(event.relatedTarget)) {
    return;
  }

  if (!pageMediaHost.contains(event.relatedTarget)) {
    hideGalleryHoverPreview();
  }
});

galleryHoverPreviewPane.addEventListener("mouseleave", (event) => {
  if (pageMediaHost.contains(event.relatedTarget) || isGalleryPreviewHoverTarget(event.relatedTarget)) {
    return;
  }

  hideGalleryHoverPreview();
});

async function refreshPageGallery() {
  pageMediaSection.hidden = false;
  setPageMediaStatus("popupPageMediaLoading");

  const tab = await getActiveTab();

  if (!tab?.id || !isScannableTabUrl(tab.url)) {
    gallerySourceTabId = -1;
    galleryPageUrl = "";
    setPageMediaStatus("popupPageMediaUnavailable");
    return;
  }

  gallerySourceTabId = tab.id;
  galleryPageUrl = tab.url ?? "";

  try {
    const allServers = await getServersFromStorage();
    const { configured, available } = partitionServersForPage(galleryPageUrl, allServers);

    if (configured.length > 0 && available.length === 0) {
      setPageMediaStatus("popupGalleryNoUploadTargets");
      return;
    }

    const result = await runInTab(tab.id, enumeratePageMediaInPage, []);
    const items = result?.items ?? [];

    if (items.length === 0) {
      setPageMediaStatus("popupNoPageMedia");
      return;
    }

    renderPageMediaGallery(items);
  } catch (err) {
    console.warn("Page media scan failed:", err);
    setPageMediaStatus("popupPageMediaUnavailable");
  }
}

async function refreshPopup() {
  const servers = await getServersFromStorage();
  renderServerLinks(getDistinctBooruInstances(servers));
  await refreshPageGallery();
}

document.getElementById("openSettings").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

document.addEventListener("click", (event) => {
  if (Date.now() < galleryMenuIgnoreDismissUntil) {
    return;
  }

  if (
    !galleryServerMenu.hidden &&
    !event.target.closest("#galleryServerMenu") &&
    !event.target.closest(".media-cell")
  ) {
    closeGalleryServerMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGalleryServerMenu();
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.servers) {
    refreshPopup();
  }
});

localizePage();
refreshPopup();
