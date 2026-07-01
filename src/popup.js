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
const transferHistory = document.getElementById("transferHistory");
const transferHistoryList = document.getElementById("transferHistoryList");
const transferHistoryEmpty = document.getElementById("transferHistoryEmpty");
const transferHistoryClear = document.getElementById("transferHistoryClear");

/** Reserved left column width (must match CSS .gallery-hover-preview-pane). */
const GALLERY_PREVIEW_PANE_WIDTH = 360;
/** Match background.js BADGE_CLEAR_MS so toolbar and gallery feedback stay in sync. */
const GALLERY_UPLOAD_FEEDBACK_MS = 2500;
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
/** When set, the next save click for this pair should request media host access first. */
let mediaHostRetryTarget = null;
/** Active popup retry banner: upload auth or media-host permission. */
let popupRetryBannerKind = null;
/** Auto-hide popup retry banners after this long (see pending createdAt). */
const POPUP_RETRY_BANNER_CLEAR_MS = 8000;
let popupRetryBannerClearTimeout = null;
/** Last server list loaded by the popup (used for sync save routing without losing user gesture). */
let galleryServersCache = null;
let galleryPageUrl = "";
let galleryMenuIgnoreDismissUntil = 0;
let galleryItems = [];
let galleryViewFilter = GALLERY_FILTER_ALL;
let galleryViewSort = GALLERY_SORT_DOCUMENT;
let galleryViewSortAscending = true;
let galleryLastSortKey = GALLERY_SORT_DOCUMENT;
let pageGalleryRefreshId = 0;
let popupRefreshInFlight = false;

const galleryUploadByteSizeCache = new Map();
const galleryByteSizeProbeInFlight = new Set();
let galleryHoverPreviewSession = 0;
let galleryHoverPreviewContext = null;
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const galleryUploadFeedbackTimeouts = new Map();

function srcUrlForGalleryItem(item) {
  return item.srcUrl || "";
}

function galleryFilenameLabel(item) {
  const srcUrl = srcUrlForGalleryItem(item);

  return previewFilenameFromUrl(srcUrl) || item.filename || item.kind || "";
}

function clearGalleryUploadByteSizeCache() {
  galleryUploadByteSizeCache.clear();
  galleryByteSizeProbeInFlight.clear();
}

function refreshGalleryHoverPreviewCaptionIfActive(srcUrl) {
  const context = galleryHoverPreviewContext;

  if (!context || context.srcUrl !== srcUrl) {
    return;
  }

  if (!galleryHoverPreview.classList.contains("gallery-hover-preview--visible")) {
    return;
  }

  updateGalleryHoverPreviewCaption(
    context.srcUrl,
    context.intrinsicWidth,
    context.intrinsicHeight,
    context.altText
  );
}

function setGalleryUploadByteSize(srcUrl, byteSize) {
  if (!srcUrl || !Number.isFinite(byteSize) || byteSize < 0) {
    return;
  }

  galleryUploadByteSizeCache.set(srcUrl, byteSize);
  const formatted = formatFileByteSize(byteSize);

  for (const cell of pageMediaHost.querySelectorAll(".media-cell")) {
    if (cell.dataset.srcUrl !== srcUrl) {
      continue;
    }

    const label = cell.querySelector(".media-filename");

    if (label) {
      const base =
        label.dataset.baseLabel ||
        label.textContent.split(" · ")[0] ||
        previewFilenameFromUrl(srcUrl);

      label.dataset.baseLabel = base;
      label.textContent = `${base} · ${formatted}`;
    }

    cell.dataset.byteSize = String(byteSize);
  }

  refreshGalleryHoverPreviewCaptionIfActive(srcUrl);
}

async function probeGalleryUploadByteSize(srcUrl) {
  if (!srcUrl || galleryUploadByteSizeCache.has(srcUrl)) {
    return;
  }

  if (galleryByteSizeProbeInFlight.has(srcUrl)) {
    return;
  }

  galleryByteSizeProbeInFlight.add(srcUrl);

  try {
    const response = await browser.runtime.sendMessage({
      type: "fetchMediaByteSize",
      payload: {
        tabId: gallerySourceTabId,
        srcUrl
      }
    });

    if (response?.ok && Number.isFinite(response.byteSize)) {
      setGalleryUploadByteSize(srcUrl, response.byteSize);
    }
  } catch (err) {
    console.warn("Gallery byte-size probe failed:", err);
  } finally {
    galleryByteSizeProbeInFlight.delete(srcUrl);
  }
}

function scheduleGalleryUploadByteSizeProbes(items) {
  const srcUrls = new Set();

  for (const item of items) {
    const srcUrl = srcUrlForGalleryItem(item);

    if (srcUrl) {
      srcUrls.add(srcUrl);
    }
  }

  for (const srcUrl of srcUrls) {
    void probeGalleryUploadByteSize(srcUrl);
  }
}

function ensureGalleryUploadByteSizeProbed(srcUrl) {
  if (!srcUrl || galleryUploadByteSizeCache.has(srcUrl)) {
    return;
  }

  void probeGalleryUploadByteSize(srcUrl);
}

function defaultSortAscending(sortKey) {
  return sortKey !== GALLERY_SORT_PIXELS;
}

function fileExtensionFromItem(item) {
  const url = item.srcUrl || "";
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
  scheduleGalleryUploadByteSizeProbes(sorted);
  void applyPendingPopupAlerts();
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

function hostnameFromMediaUrl(url) {
  if (!url) {
    return "";
  }

  try {
    const { hostname, protocol } = new URL(url);

    if (!hostname || protocol === "data:" || protocol === "blob:") {
      return "";
    }

    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch (err) {
    return "";
  }
}
function formatTransferHistoryUrlLabel(url) {
  if (!url) {
    return "";
  }

  let name = "";

  try {
    const pathname = new URL(url).pathname;
    name = decodeURIComponent(pathname.split("/").pop() || pathname);
  } catch (err) {
    const fallback = url.split("/").pop()?.split("?")[0];

    if (fallback) {
      try {
        name = decodeURIComponent(fallback);
      } catch (decodeErr) {
        name = fallback;
      }
    } else {
      name = url;
    }
  }

  if (!name) {
    name = url;
  }

  const host = hostnameFromMediaUrl(url);
  const suffix = host ? ` (${host})` : "";
  const maxNameLen = host ? Math.max(12, 48 - suffix.length) : 48;

  if (name.length > maxNameLen) {
    name = `${name.slice(0, Math.max(0, maxNameLen - 1))}…`;
  }

  return host ? `${name}${suffix}` : name;
}

function transferHistoryStatusMeta(status) {
  if (status === TRANSFER_STATUS_PENDING) {
    return {
      className: "transfer-history__status--pending",
      icon: "↻",
      labelKey: "popupTransferStatusPending"
    };
  }

  if (status === TRANSFER_STATUS_SUCCESS) {
    return {
      className: "transfer-history__status--success",
      icon: "✓",
      labelKey: "popupTransferStatusSuccess"
    };
  }

  return {
    className: "transfer-history__status--failure",
    icon: "✗",
    labelKey: "popupTransferStatusFailure"
  };
}

function renderTransferHistory(entries) {
  const list = entries || [];

  if (list.length === 0) {
    transferHistoryList.hidden = true;
    transferHistoryList.replaceChildren();
    transferHistoryEmpty.hidden = false;
    transferHistoryClear.hidden = true;
    updateTransferHistoryVisibility();
    return;
  }

  transferHistoryEmpty.hidden = true;
  transferHistoryClear.hidden = false;
  transferHistoryList.hidden = false;
  transferHistoryList.replaceChildren();

  for (const entry of list.slice(0, TRANSFER_HISTORY_MAX_ENTRIES)) {
    const item = document.createElement("li");
    item.className = "transfer-history__item";

    const thumb = document.createElement("img");
    thumb.className = "transfer-history__thumb";
    thumb.alt = "";
    thumb.loading = "lazy";
    thumb.decoding = "async";
    thumb.src = isVideoPreviewUrl(entry.srcUrl) ? "" : entry.srcUrl;
    thumb.addEventListener("error", () => {
      thumb.classList.add("transfer-history__thumb--broken");
      thumb.removeAttribute("src");
    });

    const label = formatTransferHistoryUrlLabel(entry.srcUrl);
    const url = document.createElement("span");
    url.className = "transfer-history__url";

    if (entry.status === TRANSFER_STATUS_SUCCESS && entry.mediaPageUrl) {
      const link = document.createElement("a");
      link.href = entry.mediaPageUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label;
      link.title = entry.mediaPageUrl;
      url.appendChild(link);
    } else {
      url.textContent = label;
      url.title = entry.srcUrl;
    }

    const statusMeta = transferHistoryStatusMeta(entry.status);
    const status = document.createElement("span");
    status.className = `transfer-history__status ${statusMeta.className}`;
    status.textContent = statusMeta.icon;
    status.setAttribute("aria-label", browser.i18n.getMessage(statusMeta.labelKey));

    if (entry.status === TRANSFER_STATUS_FAILURE && entry.errorMessage) {
      status.title = entry.errorMessage;
    }

    const sizeText = formatFileByteSize(entry.byteSize);
    const size = document.createElement("span");
    size.className = "transfer-history__size";
    size.textContent = sizeText;
    size.hidden = !sizeText;

    item.append(thumb, url, size, status);
    transferHistoryList.appendChild(item);
  }

  updateTransferHistoryVisibility();
}

function updateTransferHistoryVisibility() {
  const previewVisible = galleryHoverPreview.classList.contains(
    "gallery-hover-preview--visible"
  );

  transferHistory.hidden = previewVisible;
}

async function loadTransferHistory() {
  renderTransferHistory(await readTransferHistory());
}

transferHistoryClear.addEventListener("click", () => {
  void clearTransferHistory();
});

function hideGalleryHoverPreview() {
  galleryHoverPreviewContext = null;

  galleryHoverPreview.classList.remove("gallery-hover-preview--visible");
  galleryHoverPreview.hidden = true;
  galleryHoverPreview.setAttribute("aria-hidden", "true");
  galleryHoverPreviewPane.classList.add("gallery-hover-preview-pane--history");
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
  updateTransferHistoryVisibility();
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

  const sizeText = labelUrl ? formatFileByteSize(galleryUploadByteSizeCache.get(labelUrl)) : "";

  const width =
    intrinsicWidth ||
    galleryHoverPreviewVideo.videoWidth ||
    galleryHoverPreviewImg.naturalWidth;
  const height =
    intrinsicHeight ||
    galleryHoverPreviewVideo.videoHeight ||
    galleryHoverPreviewImg.naturalHeight;

  if (width > 0 && height > 0) {
    const dimensions = `${width} × ${height}`;
    galleryHoverPreviewDimensions.textContent = sizeText
      ? `${dimensions} · ${sizeText}`
      : dimensions;
    galleryHoverPreviewDimensions.hidden = false;
  } else if (sizeText) {
    galleryHoverPreviewDimensions.textContent = sizeText;
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

  updateGalleryHoverPreviewCaption(labelUrl, intrinsicWidth, intrinsicHeight, altText);
}

function showGalleryHoverPreview(
  previewUrl,
  altText,
  intrinsicWidth,
  intrinsicHeight,
  labelUrl,
  useVideoPreview = false
) {
  const captionLabelUrl = labelUrl ?? previewUrl;

  galleryHoverPreview.hidden = false;
  galleryHoverPreview.setAttribute("aria-hidden", "false");
  galleryHoverPreviewPane.classList.remove("gallery-hover-preview-pane--history");
  galleryHoverPreview.classList.add("gallery-hover-preview--visible");
  transferHistory.hidden = true;

  const layout = () => {
    layoutGalleryHoverPreview(intrinsicWidth, intrinsicHeight, captionLabelUrl, altText);
  };

  if (useVideoPreview) {
    galleryHoverPreviewImg.hidden = true;
    galleryHoverPreviewImg.removeAttribute("src");
    galleryHoverPreviewImg.classList.remove("gallery-hover-preview__img--broken");
    galleryHoverPreviewImg.style.width = "";
    galleryHoverPreviewImg.style.height = "";
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
  galleryHoverPreviewVideo.style.width = "";
  galleryHoverPreviewVideo.style.height = "";
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
  const { srcUrl, intrinsicWidth = 0, intrinsicHeight = 0, kind } = item;
  const altText = item.filename || item.kind;
  const useVideoPreview = kind === "video" && isDirectVideoPreviewUrl(srcUrl);

  cell.addEventListener("mouseover", (event) => {
    if (!cell.contains(event.target)) {
      return;
    }

    const token = ++galleryHoverPreviewSession;
    galleryHoverPreviewContext = {
      token,
      srcUrl,
      kind,
      altText,
      intrinsicWidth,
      intrinsicHeight
    };

    ensureGalleryUploadByteSizeProbed(srcUrl);

    showGalleryHoverPreview(
      srcUrl,
      altText,
      intrinsicWidth,
      intrinsicHeight,
      srcUrl,
      useVideoPreview
    );
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

function popupRetryBannerRemainingMs(pending) {
  const createdAt = pending?.createdAt;

  if (!createdAt) {
    return POPUP_RETRY_BANNER_CLEAR_MS;
  }

  return Math.max(0, POPUP_RETRY_BANNER_CLEAR_MS - (Date.now() - createdAt));
}

function isPopupRetryBannerExpired(pending) {
  return popupRetryBannerRemainingMs(pending) === 0;
}

function cancelPopupRetryBannerAutoDismiss() {
  if (popupRetryBannerClearTimeout) {
    clearTimeout(popupRetryBannerClearTimeout);
    popupRetryBannerClearTimeout = null;
  }
}

function clearPopupRetryBannerChrome() {
  pageMediaStatus.classList.remove("page-media-status--host-retry");
  pageMediaStatus.removeAttribute("role");
  popupRetryBannerKind = null;
}

function showPopupRetryBanner(kind, renderContent) {
  pageMediaStatus.hidden = false;
  pageMediaStatus.replaceChildren();
  pageMediaStatus.classList.add("page-media-status--host-retry");
  pageMediaStatus.setAttribute("role", "alert");
  popupRetryBannerKind = kind;
  renderContent(pageMediaStatus);
}

function showMediaHostRetryStatus(host) {
  showPopupRetryBanner("mediaHost", (el) => {
    el.textContent = browser.i18n.getMessage("popupMediaHostRetryPrompt", host);
  });
}

function showUploadAuthRequiredStatus(booruUrl, authMode = "admin") {
  showPopupRetryBanner("uploadAuth", (el) => {
    if (authMode === "apiKey") {
      el.textContent = browser.i18n.getMessage("popupUploadApiKeyRequired");
      return;
    }

    renderAdminLoginMessage(el, booruUrl, {
      beforeKey: "popupUploadAuthFailedBefore",
      linkKey: "popupUploadAuthAdminLink",
      afterKey: "popupUploadAuthFailedAfter"
    });
  });
}

function schedulePopupRetryBannerAutoDismiss(pending) {
  cancelPopupRetryBannerAutoDismiss();

  const remainingMs = popupRetryBannerRemainingMs(pending);

  if (remainingMs === 0) {
    void dismissPopupRetryBanner();
    return;
  }

  popupRetryBannerClearTimeout = setTimeout(() => {
    popupRetryBannerClearTimeout = null;
    void dismissPopupRetryBanner();
  }, remainingMs);
}

async function dismissPopupRetryBanner() {
  const kind = popupRetryBannerKind;
  cancelPopupRetryBannerAutoDismiss();

  if (kind === "uploadAuth") {
    await clearPendingUploadAuth();
  } else if (kind === "mediaHost") {
    mediaHostRetryTarget = null;
    clearMediaHostRetryHighlight();
    await clearPendingMediaHostSave();
  } else {
    await clearPendingUploadAuth();
    mediaHostRetryTarget = null;
    clearMediaHostRetryHighlight();
    await clearPendingMediaHostSave();
  }

  popupRetryBannerKind = null;
  pageMediaStatus.classList.remove("page-media-status--host-retry");
  pageMediaStatus.removeAttribute("role");
  pageMediaStatus.hidden = true;
  pageMediaStatus.replaceChildren();
}

function clearPageMediaStatus() {
  cancelPopupRetryBannerAutoDismiss();
  clearPopupRetryBannerChrome();
  pageMediaStatus.hidden = true;
  pageMediaStatus.replaceChildren();
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

function galleryBooruPermissionPatterns(server) {
  try {
    const pattern = originPatternFromUrl(server.booruUrl);

    return pattern ? [pattern] : [];
  } catch (err) {
    return [];
  }
}

function runGalleryMediaHostPermissionRetry(srcUrl, serverId, server) {
  closeGalleryServerMenu();
  hideGalleryHoverPreview();

  if (hasInstallTimeBroadHostAccess()) {
    void beginGallerySaveWithPermissions(srcUrl, serverId, server, {
      isMediaHostRetry: true
    });
    return;
  }

  const mediaRequests = beginHostPermissionRequests(
    mediaHostPermissionPatternsForUrl(srcUrl)
  );

  if (mediaRequests.length === 0) {
    void beginGallerySaveWithPermissions(srcUrl, serverId, server, {
      isMediaHostRetry: true
    });
    return;
  }

  const payload = {
    srcUrl,
    serverId,
    tabId: gallerySourceTabId,
    pageUrl: galleryPageUrl
  };

  void awaitHostPermissionRequests(mediaRequests)
    .then((granted) =>
      browser.runtime.sendMessage({
        type: "galleryMediaHostPermissionSettled",
        payload: { granted, ...payload }
      })
    )
    .catch((err) => {
      console.warn("Media host permission request failed:", err);
      void browser.runtime.sendMessage({
        type: "galleryMediaHostPermissionSettled",
        payload: { granted: false, ...payload }
      });
    });

  window.close();
}

function clearGalleryItemUploadFeedback(cell) {
  if (!cell) {
    return;
  }

  const feedback = cell.querySelector(".media-upload-feedback");

  if (feedback) {
    feedback.hidden = true;
    feedback.classList.remove("media-upload-feedback--success", "media-upload-feedback--failure");
  }

  cell.classList.remove("media-cell--upload-success", "media-cell--upload-failure");
}

function clearGalleryItemUploadFeedbackForSrcUrl(srcUrl) {
  const existingTimeout = galleryUploadFeedbackTimeouts.get(srcUrl);

  if (existingTimeout) {
    clearTimeout(existingTimeout);
    galleryUploadFeedbackTimeouts.delete(srcUrl);
  }

  clearGalleryItemUploadFeedback(findGalleryCellForSrcUrl(srcUrl));
}

function clearAllGalleryItemUploadFeedback() {
  for (const srcUrl of galleryUploadFeedbackTimeouts.keys()) {
    clearGalleryItemUploadFeedbackForSrcUrl(srcUrl);
  }

  pageMediaHost
    .querySelectorAll(".media-cell--upload-success, .media-cell--upload-failure")
    .forEach((cell) => {
      clearGalleryItemUploadFeedback(cell);
    });
}

function showGalleryItemUploadOutcome(srcUrl, outcome) {
  const isSuccess = outcome === "success";
  const messageKey = isSuccess ? "popupGalleryUploadSuccess" : "popupGalleryUploadFailed";
  const feedbackClass = isSuccess
    ? "media-upload-feedback--success"
    : "media-upload-feedback--failure";
  const cellClass = isSuccess ? "media-cell--upload-success" : "media-cell--upload-failure";

  for (const otherSrcUrl of [...galleryUploadFeedbackTimeouts.keys()]) {
    if (otherSrcUrl !== srcUrl) {
      clearGalleryItemUploadFeedbackForSrcUrl(otherSrcUrl);
    }
  }

  clearGalleryItemUploadFeedbackForSrcUrl(srcUrl);

  const cell = findGalleryCellForSrcUrl(srcUrl);

  if (cell) {
    const wrap = cell.querySelector(".media-thumb-wrap");
    let feedback = wrap?.querySelector(".media-upload-feedback");

    if (wrap && !feedback) {
      feedback = document.createElement("div");
      feedback.className = "media-upload-feedback";
      feedback.setAttribute("aria-live", "polite");
      wrap.appendChild(feedback);
    }

    if (feedback) {
      feedback.textContent = browser.i18n.getMessage(messageKey);
      feedback.classList.remove("media-upload-feedback--success", "media-upload-feedback--failure");
      feedback.classList.add(feedbackClass);
      feedback.hidden = false;
    }

    cell.classList.remove("media-cell--upload-success", "media-cell--upload-failure");
    cell.classList.add(cellClass);
  }

  const timeout = setTimeout(() => {
    galleryUploadFeedbackTimeouts.delete(srcUrl);
    clearGalleryItemUploadFeedback(findGalleryCellForSrcUrl(srcUrl));
  }, GALLERY_UPLOAD_FEEDBACK_MS);

  galleryUploadFeedbackTimeouts.set(srcUrl, timeout);
}

function findGalleryCellForSrcUrl(srcUrl) {
  if (!srcUrl) {
    return null;
  }

  for (const cell of pageMediaHost.querySelectorAll(".media-cell")) {
    if (cell.dataset.srcUrl === srcUrl) {
      return cell;
    }
  }

  return null;
}

function clearMediaHostRetryHighlight() {
  pageMediaHost.querySelectorAll(".media-cell--host-retry").forEach((cell) => {
    cell.classList.remove("media-cell--host-retry");
  });
}

async function clearMediaHostRetryState() {
  cancelPopupRetryBannerAutoDismiss();

  if (popupRetryBannerKind === "mediaHost") {
    clearPopupRetryBannerChrome();
  }

  mediaHostRetryTarget = null;
  clearMediaHostRetryHighlight();
  await clearPendingMediaHostSave();
}

async function clearUploadAuthRetryState() {
  cancelPopupRetryBannerAutoDismiss();

  if (popupRetryBannerKind === "uploadAuth") {
    clearPopupRetryBannerChrome();
  }

  await clearPendingUploadAuth();
}

async function applyPendingUploadAuthUi() {
  const pending = await readPendingUploadAuth();

  if (!pending?.booruUrl) {
    return false;
  }

  if (isPopupRetryBannerExpired(pending)) {
    await clearUploadAuthRetryState();
    return false;
  }

  showUploadAuthRequiredStatus(pending.booruUrl, pending.authMode || "admin");
  schedulePopupRetryBannerAutoDismiss(pending);
  return true;
}

async function applyPendingPopupAlerts() {
  if (await applyPendingUploadAuthUi()) {
    return;
  }

  await applyPendingMediaHostRetryUi();
}

async function applyPendingMediaHostRetryUi() {
  clearMediaHostRetryHighlight();

  const pending = (await readPendingMediaHostSave()) || mediaHostRetryTarget;

  if (!pending?.srcUrl) {
    mediaHostRetryTarget = null;
    return;
  }

  if (await hostPermissionsGrantedForUrl(pending.srcUrl)) {
    await clearMediaHostRetryState();
    return;
  }

  if (isPopupRetryBannerExpired(pending)) {
    await clearMediaHostRetryState();
    return;
  }

  const allServers = await getServersFromStorage();

  galleryServersCache = allServers;

  const server = findServerById(allServers, pending.serverId);

  mediaHostRetryTarget = {
    srcUrl: pending.srcUrl,
    serverId: pending.serverId,
    server: server || undefined
  };

  const host = hostPermissionHostLabel(pending.srcUrl);

  showMediaHostRetryStatus(host);
  schedulePopupRetryBannerAutoDismiss(pending);

  const cell = findGalleryCellForSrcUrl(pending.srcUrl);

  if (!cell) {
    return;
  }

  cell.classList.add("media-cell--host-retry");
  cell.scrollIntoView({ block: "nearest", inline: "nearest" });

  pageMediaHost.querySelectorAll(".media-cell--show-choice").forEach((other) => {
    other.classList.remove("media-cell--show-choice");
  });
  cell.classList.add("media-cell--show-choice");

  const { available } = partitionServersForPage(galleryPageUrl, allServers);

  if (available.length > 1) {
    requestAnimationFrame(() => {
      void openGalleryServerMenu(pending.srcUrl, cell);
    });
  }
}

async function startGallerySave(srcUrl, serverId, tabPayload = null) {
  closeGalleryServerMenu();

  try {
    const response = await browser.runtime.sendMessage({
      type: "saveMediaToBlombooru",
      payload: {
        tabId: gallerySourceTabId,
        pageUrl: galleryPageUrl,
        srcUrl,
        serverId,
        tabPayload,
        booruPermissionsPreGranted: true,
        mediaPermissionsPreGranted: true
      }
    });

    if (response?.ok) {
      await clearUploadAuthRetryState();
      showGalleryItemUploadOutcome(srcUrl, "success");
    } else {
      showGalleryItemUploadOutcome(srcUrl, "failure");

      if (response) {
        console.warn("Gallery save failed:", response.error);
      }
    }
  } catch (err) {
    showGalleryItemUploadOutcome(srcUrl, "failure");
    console.warn("Gallery save message failed:", err);
  }
}

async function beginGallerySaveWithPermissions(
  srcUrl,
  serverId,
  server,
  { isMediaHostRetry = false } = {}
) {
  closeGalleryServerMenu();

  if (hasInstallTimeBroadHostAccess()) {
    await clearMediaHostRetryState();
    void startGallerySave(srcUrl, serverId);
    return;
  }

  const booruRequests = beginHostPermissionRequests(galleryBooruPermissionPatterns(server));
  const probePromise = probeTabMediaPayload(gallerySourceTabId, srcUrl);

  const booruGranted = await awaitHostPermissionRequests(booruRequests);

  if (!booruGranted) {
    notifyBooruHostPermissionDenied();
    return;
  }

  const tabPayload = await probePromise;

  if (needsMediaHostPermissionPrompt(srcUrl, galleryPageUrl, tabPayload)) {
    if (!(await hostPermissionsGrantedForUrl(srcUrl))) {
      if (!isMediaHostRetry) {
        await persistPendingMediaHostSave({
          tabId: gallerySourceTabId,
          pageUrl: galleryPageUrl,
          srcUrl,
          serverId
        });
        mediaHostRetryTarget = { srcUrl, serverId, server };
        await applyPendingMediaHostRetryUi();
        return;
      }

      notifyMediaHostPermissionDenied(srcUrl);
      return;
    }
  }

  await clearMediaHostRetryState();
  void startGallerySave(srcUrl, serverId, tabPayloadForSrcUrl(tabPayload, srcUrl));
}

function resolveMediaHostRetryServer() {
  if (mediaHostRetryTarget?.server) {
    return mediaHostRetryTarget.server;
  }

  if (mediaHostRetryTarget?.serverId && galleryServersCache) {
    return findServerById(galleryServersCache, mediaHostRetryTarget.serverId);
  }

  return null;
}

/** Must run synchronously inside a click handler (Firefox user-gesture requirement). */
function tryHandleGalleryMediaHostRetryClick(srcUrl) {
  if (!mediaHostRetryTarget || mediaHostRetryTarget.srcUrl !== srcUrl) {
    return false;
  }

  const server = resolveMediaHostRetryServer();

  if (!server) {
    return false;
  }

  runGalleryMediaHostPermissionRetry(srcUrl, mediaHostRetryTarget.serverId, server);
  return true;
}

function triggerGallerySave(srcUrl, server, { anchorEl = null } = {}) {
  const serverId = server.id;
  const isMediaHostRetry =
    mediaHostRetryTarget?.srcUrl === srcUrl &&
    mediaHostRetryTarget?.serverId === serverId;

  if (isMediaHostRetry) {
    runGalleryMediaHostPermissionRetry(srcUrl, serverId, server);
    return;
  }

  void beginGallerySaveWithPermissions(srcUrl, serverId, server);
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
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      triggerGallerySave(srcUrl, server);
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

    const keepRetryStatus =
      mediaHostRetryTarget?.srcUrl === srcUrl || popupRetryBannerKind !== null;

    if (!keepRetryStatus) {
      clearPageMediaStatus();
    }

    for (const server of available) {
      appendGalleryServerMenuItem(server, configured, {
        disabled: false,
        srcUrl
      });
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

async function handleGallerySaveTrigger(srcUrl, anchorEl) {
  let allServers = galleryServersCache;

  if (!allServers) {
    allServers = await getServersFromStorage();
    galleryServersCache = allServers;
  }

  const { configured, available, onPage } = partitionServersForPage(
    galleryPageUrl,
    allServers
  );

  if (configured.length === 0) {
    return;
  }

  if (available.length === 0 && onPage.length === 0) {
    return;
  }

  if (available.length === 1) {
    triggerGallerySave(srcUrl, available[0], { anchorEl });
    return;
  }

  await openGalleryServerMenu(srcUrl, anchorEl);
}

function bindGallerySaveTrigger(element, anchorEl) {
  let openGuardUntil = 0;

  const onSaveTrigger = (event) => {
    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (now < openGuardUntil) {
      return;
    }
    openGuardUntil = now + 300;

    const srcUrl = anchorEl.dataset.srcUrl || "";

    if (tryHandleGalleryMediaHostRetryClick(srcUrl)) {
      return;
    }

    void handleGallerySaveTrigger(srcUrl, anchorEl);
  };

  element.addEventListener("click", onSaveTrigger);
}

function createUploadOverlay(cell) {
  const overlay = document.createElement("div");
  overlay.className = "media-choice-overlay media-choice-overlay--single";

  const uploadButton = document.createElement("button");
  uploadButton.type = "button";
  uploadButton.className = "media-choice-single";
  const uploadLabel = browser.i18n.getMessage("popupGalleryUpload");
  uploadButton.title = uploadLabel;
  uploadButton.textContent = uploadLabel;
  bindGallerySaveTrigger(uploadButton, cell);

  overlay.appendChild(uploadButton);
  return overlay;
}

function renderPageMediaGallery(items) {
  hideGalleryHoverPreview();
  clearAllGalleryItemUploadFeedback();
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
    const srcUrl = item.srcUrl || "";

    const cell = document.createElement("div");
    cell.className = "media-cell";
    cell.setAttribute("role", "listitem");
    cell.dataset.srcUrl = srcUrl;
    cell.dataset.mediaKind = item.kind;
    cell.title = srcUrl;

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "media-thumb-wrap";

    const img = document.createElement("img");
    img.className = "media-thumb";
    img.alt = item.filename || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = srcUrl;

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

    thumbWrap.appendChild(createUploadOverlay(cell));

    cell.appendChild(thumbWrap);

    const label = document.createElement("div");
    label.className = "media-filename";
    const filename = galleryFilenameLabel(item);
    label.dataset.baseLabel = filename;
    label.textContent = filename;

    const cachedSize = galleryUploadByteSizeCache.get(srcUrl);

    if (cachedSize != null) {
      label.textContent = `${filename} · ${formatFileByteSize(cachedSize)}`;
      cell.dataset.byteSize = String(cachedSize);
    }

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
  clearGalleryUploadByteSizeCache();
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

      galleryServersCache = servers;
      renderServerLinks(getDistinctBooruInstances(servers));
    } catch (err) {
      console.warn("Failed to load configured servers:", err);
      galleryServersCache = null;
      renderServerLinks([]);
    }

    await refreshPageGallery();
    await applyPendingPopupAlerts();
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
  if (area === "session" && changes.transferHistory) {
    renderTransferHistory(changes.transferHistory.newValue || []);
    return;
  }

  if (
    area === "session" &&
    (changes.pendingUploadAuth || changes.pendingMediaHostSave)
  ) {
    void applyPendingPopupAlerts();
    return;
  }

  if (area !== "local" || !changes.servers) {
    return;
  }

  void refreshPopup();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refreshPopup();
  }
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
    return Promise.all([loadTransferHistory(), refreshPopup()]);
  })
  .catch((err) => {
    console.warn("Popup init failed:", err);
    void Promise.all([loadTransferHistory(), refreshPopup()]);
  });

window.addEventListener("pagehide", () => {
  cancelPopupRetryBannerAutoDismiss();
});
