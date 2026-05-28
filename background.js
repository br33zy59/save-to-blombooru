console.log("=== Blombooru Uploader (MV3) LOADED ===");

const PRIMARY_MENU_ID = "save-to-blombooru";
const ALT_MENU_ID = "save-to-blombooru-alt";

const BADGE_CLEAR_MS = 2500;
const BADGE_SUCCESS = "✓";
const BADGE_FAILURE = "X";
const BADGE_UPLOAD_FRAMES = [".", "..", "..."];
const BADGE_UPLOAD_INTERVAL_MS = 400;

let activeUploadCount = 0;
let badgeClearTimeout = null;
let badgeActivityInterval = null;

function setToolbarBadge(text, color) {
  browser.browserAction.setBadgeText({ text });
  if (color) {
    browser.browserAction.setBadgeBackgroundColor({ color });
  }
}

function clearToolbarBadgeSoon() {
  if (badgeClearTimeout) {
    clearTimeout(badgeClearTimeout);
  }

  badgeClearTimeout = setTimeout(() => {
    badgeClearTimeout = null;
    if (activeUploadCount === 0) {
      browser.browserAction.setBadgeText({ text: "" });
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

async function captureMediaCaption(tabId, srcUrl) {
  if (tabId < 0 || !srcUrl) {
    return "";
  }

  try {
    const results = await browser.tabs.executeScript(tabId, {
      func: extractMediaCaptionInPage,
      args: [srcUrl]
    });
    return results?.[0] || "";
  } catch (e) {
    return "";
  }
}

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== PRIMARY_MENU_ID && info.menuItemId !== ALT_MENU_ID) {
    return;
  }

  const server = info.menuItemId === ALT_MENU_ID ? "alt" : "primary";
  const settings = await browser.storage.local.get(["booruUrl", "altBooruUrl"]);
  const booruUrl = server === "alt" ? settings.altBooruUrl : settings.booruUrl;

  if (isSameServerOrigin(info.pageUrl, booruUrl)) {
    return;
  }

  const filename = info.srcUrl.split("/").pop() || "upload.bin";
  const caption = await captureMediaCaption(info.tabId, info.srcUrl);
  const description = buildUploadDescription(caption);

  performUpload({
    srcUrl: info.srcUrl,
    filename,
    source: info.srcUrl,
    description,
    server
  });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    updateContextMenus();
  }
});

async function setContextMenuVisible(menuId, visible) {
  try {
    await browser.contextMenus.update(menuId, { visible });
  } catch (e) {
    // Item may not exist (e.g. server not configured).
  }
}

// contextMenus.update(visible) applies on the *next* menu open, not the current one.
// Sync when the active tab changes so visibility is correct before the user right-clicks.
async function syncContextMenuVisibilityForPageUrl(pageUrl) {
  if (!pageUrl) {
    return;
  }

  const settings = await browser.storage.local.get([
    "booruUrl",
    "altBooruEnabled",
    "altBooruUrl"
  ]);

  if (settings.booruUrl) {
    await setContextMenuVisible(
      PRIMARY_MENU_ID,
      !isSameServerOrigin(pageUrl, settings.booruUrl)
    );
  }

  if (settings.altBooruEnabled && settings.altBooruUrl) {
    await setContextMenuVisible(
      ALT_MENU_ID,
      !isSameServerOrigin(pageUrl, settings.altBooruUrl)
    );
  }
}

async function syncContextMenuVisibilityForTab(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    await syncContextMenuVisibilityForPageUrl(tab.url);
  } catch (e) {
    // Tab may have been closed.
  }
}

async function syncContextMenuVisibilityForActiveTab() {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  if (activeTab?.url) {
    await syncContextMenuVisibilityForPageUrl(activeTab.url);
  }
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

function getMenuTitle(friendlyName, hasAltServer, isAlt) {
  const name = (friendlyName || "").trim();

  if (name) {
    return browser.i18n.getMessage("contextMenuWithName", name);
  }

  if (!hasAltServer) {
    return browser.i18n.getMessage("contextMenuBase");
  }

  if (isAlt) {
    return browser.i18n.getMessage("contextMenuAlt");
  }

  return browser.i18n.getMessage("contextMenuBase");
}

async function updateContextMenus() {
  const settings = await browser.storage.local.get([
    "serverName",
    "booruUrl",
    "altBooruEnabled",
    "altBooruUrl",
    "altServerName"
  ]);

  const hasPrimary = Boolean(settings.booruUrl);
  const hasAlt = Boolean(settings.altBooruEnabled && settings.altBooruUrl);

  browser.contextMenus.remove(PRIMARY_MENU_ID, () => {
    if (browser.runtime.lastError) {
      // Menu item did not exist yet.
    }

    if (hasPrimary) {
      const primaryTitle = getMenuTitle(settings.serverName, hasAlt, false);

      browser.contextMenus.create({
        id: PRIMARY_MENU_ID,
        title: primaryTitle,
        contexts: ["image", "video"]
      });
    }

    browser.contextMenus.remove(ALT_MENU_ID, () => {
      if (browser.runtime.lastError) {
        // Menu item did not exist yet.
      }

      if (hasAlt) {
        const altTitle = getMenuTitle(settings.altServerName, true, true);

        browser.contextMenus.create({
          id: ALT_MENU_ID,
          title: altTitle,
          contexts: ["image", "video"]
        });
      }

      syncContextMenuVisibilityForActiveTab();
    });
  });
}

function uploadErrorMessage(status, bodyText) {
  if (status === 401 || status === 403) {
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
    const settings = await browser.storage.local.get([
      "serverName",
      "booruUrl",
      "rating",
      "altBooruEnabled",
      "altServerName",
      "altBooruUrl",
      "altRating"
    ]);

    const useAlt = data.server === "alt";
    const hasAlt = Boolean(settings.altBooruEnabled && settings.altBooruUrl);

    if (useAlt && !hasAlt) {
      throw new Error(browser.i18n.getMessage("errorAltServerNotConfigured"));
    }

    const booruUrl = (useAlt ? settings.altBooruUrl : settings.booruUrl).replace(/\/$/, "");
    const rating = useAlt ? settings.altRating : settings.rating;
    const uploadUrl = getMediaUploadUrl(booruUrl);

    const mediaResponse = await fetch(data.srcUrl);

    if (!mediaResponse.ok) {
      throw new Error(
        browser.i18n.getMessage("errorDownloadFailed", String(mediaResponse.status))
      );
    }

    const blob = await mediaResponse.blob();
    const form = new FormData();

    form.append("file", blob, data.filename);
    form.append("rating", rating || "safe");

    if (data.source) {
      form.append("source", data.source);
    }

    const uploadResponse = await fetch(uploadUrl, {
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
        const patchResponse = await fetch(getMediaItemUrl(booruUrl, uploaded.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: data.description })
        });

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
      iconUrl: "icon.png",
      title: browser.i18n.getMessage("notificationUploadFailedTitle"),
      message: err.message
    });
  }
}

browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

updateContextMenus();
