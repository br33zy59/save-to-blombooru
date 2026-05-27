console.log("=== Blombooru Uploader (MV3) LOADED ===");

const PRIMARY_MENU_ID = "save-to-blombooru";
const ALT_MENU_ID = "save-to-blombooru-alt";
const MENU_BASE_TITLE = "Save to Blombooru";

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

browser.contextMenus.create({
  id: PRIMARY_MENU_ID,
  title: MENU_BASE_TITLE,
  contexts: ["image", "video"]
});

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== PRIMARY_MENU_ID && info.menuItemId !== ALT_MENU_ID) {
    return;
  }

  const filename = info.srcUrl.split("/").pop() || "upload.bin";
  const server = info.menuItemId === ALT_MENU_ID ? "alt" : "primary";

  performUpload({
    srcUrl: info.srcUrl,
    filename,
    source: info.srcUrl,
    server
  });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    updateContextMenus();
  }
});

function getMenuTitle(friendlyName, hasAltServer, isAlt) {
  const name = (friendlyName || "").trim();

  if (name) {
    return `${MENU_BASE_TITLE} (${name})`;
  }

  if (!hasAltServer) {
    return MENU_BASE_TITLE;
  }

  if (isAlt) {
    return `${MENU_BASE_TITLE} (Alt)`;
  }

  return MENU_BASE_TITLE;
}

async function updateContextMenus() {
  const settings = await browser.storage.local.get([
    "serverName",
    "booruUrl",
    "altBooruEnabled",
    "altBooruUrl",
    "altServerName"
  ]);

  const hasAlt = Boolean(settings.altBooruEnabled && settings.altBooruUrl);
  const primaryTitle = getMenuTitle(settings.serverName, hasAlt, false);

  browser.contextMenus.update(PRIMARY_MENU_ID, { title: primaryTitle });

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
  });
}

function uploadErrorMessage(status, bodyText) {
  if (status === 401 || status === 403) {
    return "Upload failed: this Blombooru instance requires authentication. Use a no-auth instance for now.";
  }

  if (status === 405) {
    return "Upload failed: method not allowed. Check your Blombooru base URL.";
  }

  return `Upload failed: ${status} ${bodyText}`;
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
      throw new Error("Alternative server is not configured.");
    }

    const booruUrl = (useAlt ? settings.altBooruUrl : settings.booruUrl).replace(/\/$/, "");
    const rating = useAlt ? settings.altRating : settings.rating;
    const uploadUrl = getMediaUploadUrl(booruUrl);

    const mediaResponse = await fetch(data.srcUrl);

    if (!mediaResponse.ok) {
      throw new Error(`Download failed: ${mediaResponse.status}`);
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

    finishUpload("success");
  } catch (err) {
    console.error(err);
    finishUpload("failure");

    browser.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "Upload Failed",
      message: err.message
    });
  }
}

browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

updateContextMenus();
