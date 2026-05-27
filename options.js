const saveButton = document.getElementById("save");
const saveStatusEl = document.getElementById("status");
const altBooruEnabledCheckbox = document.getElementById("altBooruEnabled");
const altServerSection = document.getElementById("altServerSection");
const defaultSaveLabel = saveButton.textContent;

function showSaveStatus(message, type) {
  saveStatusEl.textContent = message;
  saveStatusEl.className = type || "";
}

function setSaveEnabled(enabled) {
  saveButton.disabled = !enabled;
}

function getOriginPattern(booruUrl) {
  return new URL(booruUrl).origin + "/*";
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

  return browser.permissions.request({
    origins: [originPattern]
  });
}

function createServerManager(elements, onStateChange) {
  let connectionValid = false;
  let validationRequestId = 0;

  function showUrlStatus(message, type) {
    elements.urlStatusEl.textContent = message;
    elements.urlStatusEl.className = type ? `field-status ${type}` : "field-status";
  }

  function setGrantAccessVisible(visible) {
    elements.grantAccessButton.hidden = !visible;
  }

  function canSave() {
    return connectionValid;
  }

  function invalidateConnection() {
    connectionValid = false;
    setGrantAccessVisible(false);
    onStateChange();
  }

  async function validateConnection(requestPermission = false) {
    const requestId = ++validationRequestId;
    const booruUrl = elements.booruUrlInput.value.trim();

    try {
      if (!booruUrl) {
        showUrlStatus("", "");
        invalidateConnection();
        return;
      }

      let originPattern;
      try {
        originPattern = getOriginPattern(booruUrl);
      } catch (e) {
        showUrlStatus("Invalid URL.", "error");
        connectionValid = false;
        setGrantAccessVisible(false);
        return;
      }

      connectionValid = false;
      setGrantAccessVisible(false);

      if (requestId !== validationRequestId) return;

      let hasPermission;
      try {
        hasPermission = await ensureHostPermission(originPattern, requestPermission);
      } catch (e) {
        if (requestId !== validationRequestId) return;
        showUrlStatus(e.message, "error");
        return;
      }

      if (requestId !== validationRequestId) return;

      if (!hasPermission) {
        showUrlStatus("Browser permission required to test this address.", "info");
        setGrantAccessVisible(true);
        return;
      }

      showUrlStatus("Testing connection...", "info");

      try {
        await testBlombooruConnection(booruUrl);
      } catch (e) {
        if (requestId !== validationRequestId) return;
        showUrlStatus(e.message, "error");
        return;
      }

      if (requestId !== validationRequestId) return;

      connectionValid = true;
      showUrlStatus("Connection successful!", "success");
    } finally {
      if (requestId === validationRequestId) {
        onStateChange();
      }
    }
  }

  function onUrlInput() {
    connectionValid = false;
    setGrantAccessVisible(false);
    showUrlStatus("", "");
    onStateChange();
  }

  function bindEvents() {
    elements.grantAccessButton.addEventListener("click", () => {
      validateConnection(true);
    });

    elements.booruUrlInput.addEventListener("input", onUrlInput);

    elements.booruUrlInput.addEventListener("blur", () => {
      validateConnection(false);
    });
  }

  function getSaveData() {
    return {
      serverName: elements.friendlyNameInput.value.trim(),
      booruUrl: elements.booruUrlInput.value.trim(),
      rating: elements.ratingInput.value
    };
  }

  return {
    bindEvents,
    validateConnection,
    canSave,
    getSaveData,
    loadValues(booruUrl, rating, serverName) {
      elements.friendlyNameInput.value = serverName || "";
      if (booruUrl) elements.booruUrlInput.value = booruUrl;
      elements.ratingInput.value = rating || "safe";
    }
  };
}

let primaryServer;
let altServer;

function refreshSaveButton() {
  let canSave = primaryServer.canSave();

  if (altBooruEnabledCheckbox.checked) {
    canSave = canSave && altServer.canSave();
  }

  setSaveEnabled(canSave);
}

primaryServer = createServerManager({
  friendlyNameInput: document.getElementById("serverName"),
  booruUrlInput: document.getElementById("booruUrl"),
  grantAccessButton: document.getElementById("grantAccess"),
  urlStatusEl: document.getElementById("urlStatus"),
  ratingInput: document.getElementById("rating")
}, refreshSaveButton);

altServer = createServerManager({
  friendlyNameInput: document.getElementById("altServerName"),
  booruUrlInput: document.getElementById("altBooruUrl"),
  grantAccessButton: document.getElementById("altGrantAccess"),
  urlStatusEl: document.getElementById("altUrlStatus"),
  ratingInput: document.getElementById("altRating")
}, refreshSaveButton);

function setAltServerVisible(visible) {
  altServerSection.hidden = !visible;
}

primaryServer.bindEvents();
altServer.bindEvents();

altBooruEnabledCheckbox.addEventListener("change", () => {
  setAltServerVisible(altBooruEnabledCheckbox.checked);
  refreshSaveButton();
});

saveButton.addEventListener("click", async () => {
  if (!primaryServer.canSave()) return;
  if (altBooruEnabledCheckbox.checked && !altServer.canSave()) return;

  const primary = primaryServer.getSaveData();
  const altEnabled = altBooruEnabledCheckbox.checked;
  const alt = altEnabled ? altServer.getSaveData() : null;

  saveButton.disabled = true;
  saveButton.classList.remove("saved");

  try {
    await browser.storage.local.set({
      serverName: primary.serverName,
      booruUrl: primary.booruUrl,
      rating: primary.rating,
      altBooruEnabled: altEnabled,
      altServerName: alt ? alt.serverName : "",
      altBooruUrl: alt ? alt.booruUrl : "",
      altRating: alt ? alt.rating : "safe"
    });

    saveButton.classList.add("saved");
    saveButton.textContent = "Saved!";
    showSaveStatus("Settings saved.", "success");

    window.setTimeout(() => {
      saveButton.classList.remove("saved");
      saveButton.textContent = defaultSaveLabel;
    }, 2000);
  } catch (e) {
    showSaveStatus("Failed to save settings.", "error");
  } finally {
    refreshSaveButton();
  }
});

async function load() {
  const s = await browser.storage.local.get([
    "serverName",
    "booruUrl",
    "rating",
    "altBooruEnabled",
    "altServerName",
    "altBooruUrl",
    "altRating"
  ]);

  primaryServer.loadValues(s.booruUrl, s.rating, s.serverName);
  altServer.loadValues(s.altBooruUrl, s.altRating, s.altServerName);

  altBooruEnabledCheckbox.checked = Boolean(s.altBooruEnabled);
  setAltServerVisible(altBooruEnabledCheckbox.checked);

  setSaveEnabled(false);

  if (s.booruUrl) {
    await primaryServer.validateConnection(false);
  }

  if (altBooruEnabledCheckbox.checked && s.altBooruUrl) {
    await altServer.validateConnection(false);
  }

  refreshSaveButton();
}

load();
