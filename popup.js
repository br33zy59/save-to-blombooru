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
const galleryHoverPreviewVideo = document.getElementById("galleryHoverPreviewVideo");
const galleryHoverPreviewFilename = document.getElementById("galleryHoverPreviewFilename");
const galleryHoverPreviewDimensions = document.getElementById("galleryHoverPreviewDimensions");
const galleryToolbar = document.getElementById("galleryToolbar");
const galleryFilterDetails = document.getElementById("galleryFilterDetails");
const galleryFilterSummary = document.getElementById("galleryFilterSummary");
const galleryFilterMenu = document.getElementById("galleryFilterMenu");
const gallerySortDetails = document.getElementById("gallerySortDetails");
const gallerySortSummary = document.getElementById("gallerySortSummary");
const gallerySortMenu = document.getElementById("gallerySortMenu");
const galleryItemCount = document.getElementById("galleryItemCount");

/** Reserved left column width (must match CSS .gallery-hover-preview-pane). */
const GALLERY_PREVIEW_PANE_WIDTH = 360;
const GALLERY_PREVIEW_PANE_PADDING = 20;
const GALLERY_PREVIEW_MAX_WIDTH = GALLERY_PREVIEW_PANE_WIDTH - GALLERY_PREVIEW_PANE_PADDING;
const GALLERY_PREVIEW_MAX_HEIGHT = 460;

const GALLERY_FILTER_ALL = "all";
const GALLERY_FILTER_IMAGE = "image";
const GALLERY_FILTER_ANIMATED = "animated";
const GALLERY_FILTER_VIDEO = "video";

const GALLERY_SORT_DOCUMENT = "document";
const GALLERY_SORT_NAME = "name";
const GALLERY_SORT_PIXELS = "pixels";
const GALLERY_SORT_TYPE = "type";

const GALLERY_FILTER_OPTIONS = [
  { value: GALLERY_FILTER_ALL, labelKey: "popupGalleryFilterAll" },
  { value: GALLERY_FILTER_IMAGE, labelKey: "popupGalleryFilterImages" },
  { value: GALLERY_FILTER_ANIMATED, labelKey: "popupGalleryFilterAnimations" },
  { value: GALLERY_FILTER_VIDEO, labelKey: "popupGalleryFilterVideos" }
];

const GALLERY_SORT_OPTIONS = [
  { value: GALLERY_SORT_DOCUMENT, labelKey: "popupGallerySortDocument" },
  { value: GALLERY_SORT_NAME, labelKey: "popupGallerySortName" },
  { value: GALLERY_SORT_PIXELS, labelKey: "popupGallerySortPixels" },
  { value: GALLERY_SORT_TYPE, labelKey: "popupGallerySortFileType" }
];

const GALLERY_SORT_DIRECTION_KEYS = {
  [GALLERY_SORT_DOCUMENT]: {
    asc: "popupGallerySortAscDocument",
    desc: "popupGallerySortDescDocument"
  },
  [GALLERY_SORT_NAME]: {
    asc: "popupGallerySortAscName",
    desc: "popupGallerySortDescName"
  },
  [GALLERY_SORT_PIXELS]: {
    asc: "popupGallerySortAscPixels",
    desc: "popupGallerySortDescPixels"
  },
  [GALLERY_SORT_TYPE]: {
    asc: "popupGallerySortAscFileType",
    desc: "popupGallerySortDescFileType"
  }
};

let gallerySourceTabId = -1;
let galleryPageUrl = "";
let galleryMenuIgnoreDismissUntil = 0;
let galleryItems = [];
let galleryViewFilter = GALLERY_FILTER_ALL;
let galleryViewSort = GALLERY_SORT_DOCUMENT;
let galleryViewSortAscending = true;
let galleryLastSortKey = GALLERY_SORT_DOCUMENT;
let pageGalleryRefreshId = 0;
let popupRefreshInFlight = false;

const GALLERY_REMOTE_FULL_PREVIEW_DELAY_MS = 220;
const galleryRemoteFullPreviewCache = new Map();
let galleryHoverPreviewSession = 0;
let galleryHoverPreviewContext = null;
let galleryRemoteFullPreviewTimer = null;

function defaultSortAscending(sortKey) {
  return sortKey !== GALLERY_SORT_PIXELS;
}

function fileExtensionFromItem(item) {
  const url = item.uploadUrl || item.displayUrl || "";
  const name = previewFilenameFromUrl(url) || item.filename || "";

  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase();
  }

  return "";
}

function filterGalleryItems(items, filter) {
  if (filter === GALLERY_FILTER_ALL) {
    return items;
  }

  return items.filter((item) => item.kind === filter);
}

function countGalleryItemsByKind(items) {
  const counts = {
    [GALLERY_FILTER_IMAGE]: 0,
    [GALLERY_FILTER_ANIMATED]: 0,
    [GALLERY_FILTER_VIDEO]: 0
  };

  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(counts, item.kind)) {
      counts[item.kind] += 1;
    }
  }

  return counts;
}

function isGalleryFilterAvailable(filterValue, kindCounts) {
  if (filterValue === GALLERY_FILTER_ALL) {
    return true;
  }

  return (kindCounts[filterValue] || 0) > 0;
}

function normalizeGalleryViewFilter() {
  const kindCounts = countGalleryItemsByKind(galleryItems);

  if (!isGalleryFilterAvailable(galleryViewFilter, kindCounts)) {
    galleryViewFilter = GALLERY_FILTER_ALL;
    void saveGalleryViewPrefs();
  }

  return kindCounts;
}

function comparePixelArea(a, b) {
  const areaA = (a.intrinsicWidth || 0) * (a.intrinsicHeight || 0);
  const areaB = (b.intrinsicWidth || 0) * (b.intrinsicHeight || 0);
  const knownA = areaA > 0;
  const knownB = areaB > 0;

  if (knownA && !knownB) {
    return -1;
  }

  if (!knownA && knownB) {
    return 1;
  }

  if (areaA !== areaB) {
    return areaA - areaB;
  }

  return 0;
}

function sortGalleryItems(items, sortKey, ascending) {
  const sorted = [...items];
  const direction = ascending ? 1 : -1;

  sorted.sort((a, b) => {
    let cmp = 0;

    switch (sortKey) {
      case GALLERY_SORT_NAME:
        cmp = (a.filename || "").localeCompare(b.filename || "", undefined, {
          sensitivity: "base"
        });
        break;
      case GALLERY_SORT_PIXELS:
        cmp = comparePixelArea(a, b);
        break;
      case GALLERY_SORT_TYPE: {
        const extA = fileExtensionFromItem(a);
        const extB = fileExtensionFromItem(b);
        cmp = extA.localeCompare(extB, undefined, { sensitivity: "base" });
        break;
      }
      case GALLERY_SORT_DOCUMENT:
      default:
        cmp = (a.documentOrder ?? 0) - (b.documentOrder ?? 0);
        break;
    }

    if (cmp === 0) {
      cmp = (a.documentOrder ?? 0) - (b.documentOrder ?? 0);
    }

    if (cmp === 0) {
      cmp = (a.filename || "").localeCompare(b.filename || "", undefined, {
        sensitivity: "base"
      });
    }

    return cmp * direction;
  });

  return sorted;
}

function updateGalleryItemCount(shown, total) {
  if (total === 0) {
    galleryItemCount.hidden = true;
    galleryItemCount.textContent = "";
    return;
  }

  if (shown === total) {
    galleryItemCount.textContent = browser.i18n.getMessage("popupGalleryCountAll", [
      String(total)
    ]);
  } else {
    galleryItemCount.textContent = browser.i18n.getMessage("popupGalleryCountFiltered", [
      String(shown),
      String(total)
    ]);
  }

  galleryItemCount.hidden = false;
}

function galleryFilterLabel(filterValue) {
  const entry = GALLERY_FILTER_OPTIONS.find((item) => item.value === filterValue);
  return entry ? browser.i18n.getMessage(entry.labelKey) : "";
}

function gallerySortLabel(sortValue) {
  const base = GALLERY_SORT_OPTIONS.find((item) => item.value === sortValue);
  if (!base) {
    return "";
  }

  if (sortValue !== galleryViewSort) {
    return browser.i18n.getMessage(base.labelKey);
  }

  const directionKeys = GALLERY_SORT_DIRECTION_KEYS[sortValue];
  const directionKey = galleryViewSortAscending
    ? directionKeys?.asc
    : directionKeys?.desc;

  return directionKey ? browser.i18n.getMessage(directionKey) : browser.i18n.getMessage(base.labelKey);
}

function syncGalleryControlsFromState() {
  galleryFilterSummary.textContent = galleryFilterLabel(galleryViewFilter);
  gallerySortSummary.textContent = gallerySortLabel(galleryViewSort);

  const directionKeys = GALLERY_SORT_DIRECTION_KEYS[galleryViewSort];
  const directionKey = galleryViewSortAscending
    ? directionKeys?.asc
    : directionKeys?.desc;
  gallerySortSummary.title = directionKey ? browser.i18n.getMessage(directionKey) : "";

  const kindCounts = countGalleryItemsByKind(galleryItems);

  for (const button of galleryFilterMenu.querySelectorAll(".gallery-toolbar__menu-item")) {
    const value = button.dataset.value;
    const active = value === galleryViewFilter;
    const enabled = isGalleryFilterAvailable(value, kindCounts);

    button.disabled = !enabled;
    button.classList.toggle("gallery-toolbar__menu-item--active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  for (const button of gallerySortMenu.querySelectorAll(".gallery-toolbar__menu-item")) {
    const active = button.dataset.value === galleryViewSort;
    button.classList.toggle("gallery-toolbar__menu-item--active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
}

function populateGalleryToolbarMenu(menuEl, options, onPick) {
  menuEl.replaceChildren();

  for (const entry of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-toolbar__menu-item";
    button.dataset.value = entry.value;
    button.setAttribute("role", "option");
    button.textContent = browser.i18n.getMessage(entry.labelKey);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (button.disabled) {
        return;
      }

      onPick(entry.value);
      button.closest("details")?.removeAttribute("open");
    });
    menuEl.appendChild(button);
  }
}

function populateGalleryToolbarControls() {
  populateGalleryToolbarMenu(galleryFilterMenu, GALLERY_FILTER_OPTIONS, (value) => {
    const kindCounts = countGalleryItemsByKind(galleryItems);

    if (!isGalleryFilterAvailable(value, kindCounts)) {
      return;
    }

    if (galleryViewFilter === value) {
      return;
    }

    galleryViewFilter = value;
    syncGalleryControlsFromState();
    void saveGalleryViewPrefs();
    applyGalleryView();
  });

  populateGalleryToolbarMenu(gallerySortMenu, GALLERY_SORT_OPTIONS, (value) => {
    if (value === galleryViewSort) {
      galleryViewSortAscending = !galleryViewSortAscending;
    } else {
      galleryViewSort = value;
      galleryLastSortKey = value;
      galleryViewSortAscending = defaultSortAscending(value);
    }

    syncGalleryControlsFromState();
    void saveGalleryViewPrefs();
    applyGalleryView();
  });
}

async function loadGalleryViewPrefs() {
  try {
    const data = await browser.storage.local.get("galleryViewPrefs");
    const prefs = data.galleryViewPrefs;

    if (!prefs) {
      return;
    }

    if (GALLERY_FILTER_OPTIONS.some((entry) => entry.value === prefs.filter)) {
      galleryViewFilter = prefs.filter;
    }

    if (GALLERY_SORT_OPTIONS.some((entry) => entry.value === prefs.sort)) {
      galleryViewSort = prefs.sort;
      galleryLastSortKey = prefs.sort;
    }

    if (typeof prefs.sortAscending === "boolean") {
      galleryViewSortAscending = prefs.sortAscending;
    }
  } catch (err) {
    console.warn("Failed to load gallery view preferences:", err);
  }
}

async function saveGalleryViewPrefs() {
  try {
    await mergeStorageLocal({
      galleryViewPrefs: {
        filter: galleryViewFilter,
        sort: galleryViewSort,
        sortAscending: galleryViewSortAscending
      }
    });
  } catch (err) {
    console.warn("Failed to save gallery view preferences:", err);
  }
}

function showGalleryFilterEmpty() {
  clearPageMediaStatus();
  pageMediaStatus.hidden = false;
  pageMediaStatus.textContent = browser.i18n.getMessage("popupGalleryNoFilterMatches");
  hideGalleryHoverPreview();
  pageMediaHost.replaceChildren();
  galleryToolbar.hidden = false;
  updateGalleryItemCount(0, galleryItems.length);
}

function applyGalleryView() {
  if (galleryItems.length === 0) {
    galleryToolbar.hidden = true;
    return;
  }

  galleryToolbar.hidden = false;
  normalizeGalleryViewFilter();
  syncGalleryControlsFromState();

  const filtered = filterGalleryItems(galleryItems, galleryViewFilter);
  updateGalleryItemCount(filtered.length, galleryItems.length);

  if (filtered.length === 0) {
    showGalleryFilterEmpty();
    return;
  }

  clearPageMediaStatus();
  const sorted = sortGalleryItems(filtered, galleryViewSort, galleryViewSortAscending);
  renderPageMediaGallery(sorted);
}

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
  // Toolbar popups are their own window; lastFocusedWindow often points at the popup.
  try {
    const win = await browser.windows.getLastFocused({ windowTypes: ["normal"] });
    if (win?.id != null) {
      const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
      if (tab?.id != null) {
        return tab;
      }
    }
  } catch (err) {
    // windowTypes may be unsupported; fall through.
  }

  const [focusedTab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
    windowType: "normal"
  });

  if (focusedTab?.id != null) {
    return focusedTab;
  }

  const normalWindows = await browser.windows.getAll({ windowTypes: ["normal"] });
  const browserWindow =
    normalWindows.find((entry) => entry.focused) ?? normalWindows[0];

  if (browserWindow?.id != null) {
    const [tab] = await browser.tabs.query({ active: true, windowId: browserWindow.id });
    if (tab?.id != null) {
      return tab;
    }
  }

  const [fallbackTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (fallbackTab?.id != null && isScannableTabUrl(fallbackTab.url)) {
    return fallbackTab;
  }

  return fallbackTab ?? null;
}

function clearGalleryRemoteFullPreviewTimer() {
  if (galleryRemoteFullPreviewTimer != null) {
    clearTimeout(galleryRemoteFullPreviewTimer);
    galleryRemoteFullPreviewTimer = null;
  }
}

function revokeGalleryRemoteFullPreviewCache() {
  for (const entry of galleryRemoteFullPreviewCache.values()) {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }

  galleryRemoteFullPreviewCache.clear();
}

function base64ToPreviewBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

async function ensureGalleryRemoteFullPreview(uploadUrl, kind) {
  const cached = galleryRemoteFullPreviewCache.get(uploadUrl);

  if (cached) {
    return cached;
  }

  const response = await browser.runtime.sendMessage({
    type: "fetchGalleryPreviewMedia",
    payload: {
      tabId: gallerySourceTabId,
      srcUrl: uploadUrl
    }
  });

  if (!response?.ok || !response.base64) {
    return null;
  }

  const blob = base64ToPreviewBlob(response.base64, response.mimeType);
  const objectUrl = URL.createObjectURL(blob);
  const useVideo = kind === "video" && isDirectVideoPreviewUrl(uploadUrl);
  const entry = {
    objectUrl,
    width: response.width || 0,
    height: response.height || 0,
    useVideo
  };

  galleryRemoteFullPreviewCache.set(uploadUrl, entry);
  return entry;
}

function scheduleGalleryRemoteFullPreviewUpgrade(context) {
  clearGalleryRemoteFullPreviewTimer();

  galleryRemoteFullPreviewTimer = window.setTimeout(() => {
    galleryRemoteFullPreviewTimer = null;

    if (!galleryHoverPreviewContext || galleryHoverPreviewContext.token !== context.token) {
      return;
    }

    void (async () => {
      const entry = await ensureGalleryRemoteFullPreview(context.uploadUrl, context.kind);

      if (!galleryHoverPreviewContext || galleryHoverPreviewContext.token !== context.token) {
        return;
      }

      if (!entry) {
        return;
      }

      let previewWidth = entry.width;
      let previewHeight = entry.height;

      if (entry.useVideo && (!previewWidth || !previewHeight)) {
        previewWidth = context.intrinsicWidth;
        previewHeight = context.intrinsicHeight;
      }

      showGalleryHoverPreview(
        entry.objectUrl,
        context.altText,
        previewWidth,
        previewHeight,
        false,
        context.labelUrl,
        entry.useVideo
      );
    })();
  }, GALLERY_REMOTE_FULL_PREVIEW_DELAY_MS);
}

function hideGalleryHoverPreview() {
  clearGalleryRemoteFullPreviewTimer();
  galleryHoverPreviewContext = null;

  galleryHoverPreview.classList.remove("gallery-hover-preview--visible");
  galleryHoverPreview.hidden = true;
  galleryHoverPreview.setAttribute("aria-hidden", "true");
  galleryHoverPreviewPane.setAttribute("aria-hidden", "true");
  galleryHoverPreviewFrame.style.width = "";
  galleryHoverPreviewFrame.style.height = "";
  galleryHoverPreviewFrame.style.minHeight = "";
  galleryHoverPreviewImg.style.width = "";
  galleryHoverPreviewImg.style.height = "";
  galleryHoverPreviewImg.hidden = false;
  galleryHoverPreviewVideo.pause();
  galleryHoverPreviewVideo.removeAttribute("src");
  galleryHoverPreviewVideo.hidden = true;
  galleryHoverPreviewVideo.style.width = "";
  galleryHoverPreviewVideo.style.height = "";
  galleryHoverPreviewFilename.hidden = true;
  galleryHoverPreviewFilename.textContent = "";
  galleryHoverPreviewDimensions.hidden = true;
  galleryHoverPreviewDimensions.textContent = "";
}

function isDirectVideoPreviewUrl(url) {
  if (!url) {
    return false;
  }

  try {
    return /\.(mp4|webm)(\?|$)/i.test(new URL(url).pathname);
  } catch (err) {
    return /\.(mp4|webm)(\?|$)/i.test(url);
  }
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

  const width =
    intrinsicWidth ||
    galleryHoverPreviewVideo.videoWidth ||
    galleryHoverPreviewImg.naturalWidth;
  const height =
    intrinsicHeight ||
    galleryHoverPreviewVideo.videoHeight ||
    galleryHoverPreviewImg.naturalHeight;

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
  const aspectW =
    intrinsicWidth ||
    galleryHoverPreviewVideo.videoWidth ||
    galleryHoverPreviewImg.naturalWidth;
  const aspectH =
    intrinsicHeight ||
    galleryHoverPreviewVideo.videoHeight ||
    galleryHoverPreviewImg.naturalHeight;
  const { width, height } = computeGalleryPreviewSize(
    aspectW,
    aspectH,
    GALLERY_PREVIEW_MAX_WIDTH,
    maxHeight
  );

  galleryHoverPreviewFrame.style.width = `${width}px`;
  galleryHoverPreviewFrame.style.height = `${height}px`;

  if (!galleryHoverPreviewVideo.hidden) {
    galleryHoverPreviewVideo.style.width = `${width}px`;
    galleryHoverPreviewVideo.style.height = `${height}px`;
  } else {
    galleryHoverPreviewImg.style.width = `${width}px`;
    galleryHoverPreviewImg.style.height = `${height}px`;
  }

  updateGalleryHoverPreviewCaption(
    labelUrl,
    dimensionsUnknown,
    intrinsicWidth,
    intrinsicHeight,
    altText
  );
}

function showGalleryHoverPreview(
  previewUrl,
  altText,
  intrinsicWidth,
  intrinsicHeight,
  dimensionsUnknown,
  labelUrl,
  useVideoPreview = false
) {
  const captionLabelUrl = labelUrl ?? previewUrl;

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

  if (useVideoPreview) {
    galleryHoverPreviewImg.hidden = true;
    galleryHoverPreviewImg.classList.remove("gallery-hover-preview__img--broken");
    galleryHoverPreviewVideo.hidden = false;

    if (galleryHoverPreviewVideo.src !== previewUrl) {
      galleryHoverPreviewVideo.addEventListener("loadeddata", layout, { once: true });
      galleryHoverPreviewVideo.src = previewUrl;
      galleryHoverPreviewVideo.load();
    } else {
      layout();
    }

    void galleryHoverPreviewVideo.play().catch(() => {
      layout();
    });

    if (galleryHoverPreviewVideo.readyState >= 2) {
      layout();
    }

    return;
  }

  galleryHoverPreviewVideo.pause();
  galleryHoverPreviewVideo.removeAttribute("src");
  galleryHoverPreviewVideo.hidden = true;
  galleryHoverPreviewImg.hidden = false;
  galleryHoverPreviewImg.alt = altText || "";
  galleryHoverPreviewImg.classList.remove("gallery-hover-preview__img--broken");

  if (galleryHoverPreviewImg.src !== previewUrl) {
    galleryHoverPreviewImg.addEventListener("load", layout, { once: true });
    galleryHoverPreviewImg.addEventListener(
      "error",
      () => {
        galleryHoverPreviewImg.classList.add("gallery-hover-preview__img--broken");
        layout();
      },
      { once: true }
    );
    galleryHoverPreviewImg.src = previewUrl;
  } else {
    layout();
  }

  if (galleryHoverPreviewImg.complete) {
    layout();
  }
}

function bindGalleryHoverPreview(cell, item) {
  const {
    displayUrl,
    uploadUrl,
    fullUrlAvailable,
    intrinsicWidth = 0,
    intrinsicHeight = 0,
    fullOnPage = false,
    fullIntrinsicWidth = 0,
    fullIntrinsicHeight = 0,
    kind
  } = item;
  const altText = item.filename || item.kind;

  cell.addEventListener("mouseover", (event) => {
    if (!cell.contains(event.target)) {
      return;
    }

    const hoveringFullTarget = Boolean(event.target.closest(".media-choice-half--full"));
    const labelUrl = fullUrlAvailable && hoveringFullTarget ? uploadUrl : displayUrl;
    const showFullOnPage = Boolean(fullUrlAvailable && hoveringFullTarget && fullOnPage);
    const needsRemoteFull =
      Boolean(fullUrlAvailable && hoveringFullTarget && !fullOnPage);
    const cachedRemote = needsRemoteFull
      ? galleryRemoteFullPreviewCache.get(uploadUrl)
      : null;
    const dimensionsUnknown = Boolean(needsRemoteFull && !cachedRemote);
    const previewUrl = cachedRemote
      ? cachedRemote.objectUrl
      : showFullOnPage
        ? uploadUrl
        : displayUrl;
    const previewWidth = cachedRemote
      ? cachedRemote.width || intrinsicWidth
      : showFullOnPage
        ? fullIntrinsicWidth || intrinsicWidth
        : intrinsicWidth;
    const previewHeight = cachedRemote
      ? cachedRemote.height || intrinsicHeight
      : showFullOnPage
        ? fullIntrinsicHeight || intrinsicHeight
        : intrinsicHeight;
    const useVideoPreview = cachedRemote
      ? cachedRemote.useVideo
      : showFullOnPage && kind === "video" && isDirectVideoPreviewUrl(uploadUrl);

    const token = ++galleryHoverPreviewSession;
    galleryHoverPreviewContext = {
      token,
      uploadUrl,
      kind,
      altText,
      labelUrl,
      intrinsicWidth,
      intrinsicHeight
    };

    showGalleryHoverPreview(
      previewUrl,
      altText,
      previewWidth,
      previewHeight,
      dimensionsUnknown,
      labelUrl,
      useVideoPreview
    );

    if (needsRemoteFull && !cachedRemote) {
      scheduleGalleryRemoteFullPreviewUpgrade(galleryHoverPreviewContext);
    } else {
      clearGalleryRemoteFullPreviewTimer();
    }
  });
}

function setPageMediaStatus(messageKey, { clearGalleryCache = false } = {}) {
  if (clearGalleryCache) {
    galleryItems = [];
  }

  galleryToolbar.hidden = true;
  pageMediaStatus.hidden = false;
  pageMediaStatus.textContent = browser.i18n.getMessage(messageKey);
  hideGalleryHoverPreview();
  pageMediaHost.replaceChildren();
}

function showPageMediaLoading() {
  galleryToolbar.hidden = true;
  pageMediaStatus.hidden = false;
  pageMediaStatus.textContent = browser.i18n.getMessage("popupPageMediaLoading");
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

const PENDING_GALLERY_SAVE_KEY = "pendingGallerySave";

function galleryMediaContextForSaveUrl(srcUrl) {
  const item = galleryItems.find(
    (entry) => entry.displayUrl === srcUrl || entry.uploadUrl === srcUrl
  );

  if (!item) {
    return null;
  }

  return {
    displayUrl: item.displayUrl,
    uploadUrl: item.uploadUrl,
    fullOnPage: Boolean(item.fullOnPage)
  };
}

function gallerySavePermissionPatterns(srcUrl, server) {
  const patterns = [];
  const mediaContext = galleryMediaContextForSaveUrl(srcUrl);

  if (shouldPromptForMediaHostPermission(srcUrl, galleryPageUrl, mediaContext)) {
    const mediaPattern = originPatternFromUrl(srcUrl);

    if (mediaPattern) {
      patterns.push(mediaPattern);
    }
  }

  try {
    patterns.push(originPatternFromUrl(server.booruUrl));
  } catch (err) {
    // Ignore invalid booru URL.
  }

  return patterns;
}

function notifyGallerySavePermissionDenied() {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icon.png"),
    title: browser.i18n.getMessage("notificationUploadFailedTitle"),
    message: browser.i18n.getMessage("errorUploadHostPermission")
  });
}

async function finishGallerySaveAfterPermissions(granted) {
  if (!granted) {
    await browser.storage.session.remove(PENDING_GALLERY_SAVE_KEY);
    notifyGallerySavePermissionDenied();
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: "resumePendingGallerySave"
    });

    if (response && !response.ok) {
      console.warn("Gallery save failed:", response.error);
    }
  } catch (err) {
    console.warn("Gallery save resume failed:", err);
  }
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
        serverId,
        booruPermissionsPreGranted: true,
        mediaPermissionsPreGranted: !shouldPromptForMediaHostPermission(
          srcUrl,
          galleryPageUrl,
          galleryMediaContextForSaveUrl(srcUrl)
        )
      }
    });

    if (response && !response.ok) {
      console.warn("Gallery save failed:", response.error);
    }
  } catch (err) {
    console.warn("Gallery save message failed:", err);
  }
}

function beginGallerySaveWithPermissions(srcUrl, serverId, server) {
  closeGalleryServerMenu();

  if (hasInstallTimeBroadHostAccess()) {
    void startGallerySave(srcUrl, serverId);
    return;
  }

  const mediaContext = galleryMediaContextForSaveUrl(srcUrl);
  const needsMediaHostPrompt = shouldPromptForMediaHostPermission(
    srcUrl,
    galleryPageUrl,
    mediaContext
  );
  const pendingPayload = {
    tabId: gallerySourceTabId,
    pageUrl: galleryPageUrl,
    srcUrl,
    serverId,
    booruPermissionsPreGranted: true,
    mediaPermissionsPreGranted: !needsMediaHostPrompt
  };

  void browser.storage.session.set({ [PENDING_GALLERY_SAVE_KEY]: pendingPayload });

  const permissionRequests = beginHostPermissionRequests(
    gallerySavePermissionPatterns(srcUrl, server)
  );

  if (permissionRequests.length === 0) {
    void finishGallerySaveAfterPermissions(true);
    return;
  }

  void Promise.all(permissionRequests).then((results) => {
    void finishGallerySaveAfterPermissions(results.every(Boolean));
  });
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
      beginGallerySaveWithPermissions(srcUrl, serverId, server);
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
    clearPageMediaStatus();
    pageMediaStatus.hidden = false;
    pageMediaStatus.textContent = browser.i18n.getMessage("popupNoPageMedia");
    pageMediaHost.replaceChildren();
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

    bindGalleryHoverPreview(cell, item);

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
  const refreshId = ++pageGalleryRefreshId;
  revokeGalleryRemoteFullPreviewCache();
  pageMediaSection.hidden = false;
  showPageMediaLoading();

  const tab = await getActiveTab();
  if (refreshId !== pageGalleryRefreshId) {
    return;
  }

  if (!tab?.id || !isScannableTabUrl(tab.url)) {
    gallerySourceTabId = -1;
    galleryPageUrl = "";
    setPageMediaStatus("popupPageMediaUnavailable", { clearGalleryCache: true });
    return;
  }

  gallerySourceTabId = tab.id;
  galleryPageUrl = tab.url ?? "";

  try {
    const allServers = await getServersFromStorage();
    if (refreshId !== pageGalleryRefreshId) {
      return;
    }

    const { configured, available } = partitionServersForPage(galleryPageUrl, allServers);

    if (configured.length > 0 && available.length === 0) {
      setPageMediaStatus("popupGalleryNoUploadTargets", { clearGalleryCache: true });
      return;
    }

    const result = await runInTab(tab.id, enumeratePageMediaInPage, []);
    if (refreshId !== pageGalleryRefreshId) {
      return;
    }

    galleryItems = result?.items ?? [];

    if (galleryItems.length === 0) {
      setPageMediaStatus("popupNoPageMedia", { clearGalleryCache: true });
      return;
    }

    applyGalleryView();
  } catch (err) {
    if (refreshId !== pageGalleryRefreshId) {
      return;
    }

    console.warn("Page media scan failed:", err);
    setPageMediaStatus("popupPageMediaUnavailable", { clearGalleryCache: true });
  }
}

async function refreshPopup() {
  if (popupRefreshInFlight) {
    return;
  }

  popupRefreshInFlight = true;

  try {
    try {
      const servers = await getServersFromStorage();
      renderServerLinks(getDistinctBooruInstances(servers));
    } catch (err) {
      console.warn("Failed to load configured servers:", err);
      renderServerLinks([]);
    }

    await refreshPageGallery();
  } finally {
    popupRefreshInFlight = false;
  }
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
  if (area !== "local" || !Object.prototype.hasOwnProperty.call(changes, "servers")) {
    return;
  }

  void refreshPopup();
});

function bindGalleryToolbarDetails() {
  galleryFilterDetails.addEventListener("toggle", () => {
    if (galleryFilterDetails.open) {
      gallerySortDetails.open = false;
    }
  });

  gallerySortDetails.addEventListener("toggle", () => {
    if (gallerySortDetails.open) {
      galleryFilterDetails.open = false;
    }
  });
}

populateGalleryToolbarControls();
bindGalleryToolbarDetails();

localizePage();
void loadGalleryViewPrefs()
  .then(() => {
    syncGalleryControlsFromState();
    return refreshPopup();
  })
  .catch((err) => {
    console.warn("Popup init failed:", err);
    void refreshPopup();
  });

window.addEventListener("pagehide", () => {
  revokeGalleryRemoteFullPreviewCache();
});
