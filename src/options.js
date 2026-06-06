localizePage();

function renderUploadAuthHint(hintEl, booruUrlInput) {
  renderAdminLoginMessage(hintEl, booruUrlInput.value, {
    beforeKey: "hintUploadAuthBefore",
    linkKey: "hintUploadAuthAdminLink",
    afterKey: "hintUploadAuthAfter"
  });
}

const saveButton = document.getElementById("save");
const saveButtonWrap = document.getElementById("saveButtonWrap");
const saveInvalidTooltip = browser.i18n.getMessage("tooltipSaveInvalid");
const saveStatusEl = document.getElementById("status");
const serversListEl = document.getElementById("serversList");
const addServerButton = document.getElementById("addServer");
const serverCardTemplate = document.getElementById("serverCardTemplate");
const defaultSaveLabel = browser.i18n.getMessage("buttonSaveSettings");

const serverManagers = new Map();
const removeServerDialog = document.getElementById("removeServerDialog");

function confirmRemoveServerDialog() {
  return new Promise((resolve) => {
    function onClose() {
      removeServerDialog.removeEventListener("close", onClose);
      resolve(removeServerDialog.returnValue === "confirm");
    }

    removeServerDialog.addEventListener("close", onClose);
    removeServerDialog.showModal();
  });
}

function showSaveStatus(message, type) {
  saveStatusEl.textContent = message;
  saveStatusEl.className = type || "";
}

function setSaveEnabled(enabled) {
  saveButton.disabled = !enabled;

  const showInvalidTooltip = !enabled && serverManagers.size > 0;
  saveButtonWrap.classList.toggle("save-blocked", showInvalidTooltip);

  if (showInvalidTooltip) {
    saveButtonWrap.title = saveInvalidTooltip;
  } else {
    saveButtonWrap.removeAttribute("title");
  }
}

function createServerManager(serverId, elements, onStateChange) {
  let connectionValid = false;
  let validationRequestId = 0;
  let nameFilledForUrl = "";

  function showUrlStatus(message, type) {
    elements.urlStatusEl.textContent = message;
    elements.urlStatusEl.className = type ? `field-status ${type}` : "field-status";
  }

  function setGrantAccessVisible(visible) {
    elements.grantAccessButton.hidden = !visible;
    elements.statusBlockEl.classList.toggle(
      "server-status-block--permission-required",
      visible
    );
  }

  function showPermissionRequiredPrompt() {
    showUrlStatus(
      browser.i18n.getMessage("statusPermissionRequired"),
      "permission-required"
    );
    setGrantAccessVisible(true);
  }

  function canSave() {
    return connectionValid;
  }

  function invalidateConnection() {
    connectionValid = false;
    setGrantAccessVisible(false);
    onStateChange();
  }

  function applyNormalizedBooruUrlToInput() {
    const normalized = normalizeBooruUrlInput(elements.booruUrlInput.value);

    if (normalized !== elements.booruUrlInput.value.trim()) {
      elements.booruUrlInput.value = normalized;
    }

    return normalized;
  }

  function applyInstanceAppName(booruUrl, instanceInfo) {
    if (booruUrl === nameFilledForUrl) {
      return;
    }

    const appName = instanceInfo?.app_name;

    if (typeof appName === "string" && appName.trim()) {
      elements.friendlyNameInput.value = appName.trim();
      nameFilledForUrl = booruUrl;
    }
  }

  async function validateConnection(requestPermission = false) {
    const requestId = ++validationRequestId;
    const booruUrl = applyNormalizedBooruUrlToInput();

    try {
      if (!booruUrl) {
        showUrlStatus("", "");
        invalidateConnection();
        return;
      }

      let originPattern;

      try {
        originPattern = originPatternFromUrl(booruUrl);
      } catch (e) {
        originPattern = null;
      }

      if (!originPattern) {
        showUrlStatus(browser.i18n.getMessage("errorInvalidUrl"), "error");
        connectionValid = false;
        setGrantAccessVisible(false);
        onStateChange();
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
        onStateChange();
        return;
      }

      if (requestId !== validationRequestId) return;

      if (!hasPermission) {
        showPermissionRequiredPrompt();
        onStateChange();
        return;
      }

      showUrlStatus(browser.i18n.getMessage("statusTestingConnection"), "info");

      const apiKey = elements.apiKeyInput.value;
      let instanceInfo;

      try {
        instanceInfo = await testBlombooruConnection(booruUrl, apiKey);
      } catch (e) {
        if (requestId !== validationRequestId) return;
        showUrlStatus(e.message, "error");
        onStateChange();
        return;
      }

      if (requestId !== validationRequestId) return;

      applyInstanceAppName(booruUrl, instanceInfo);
      connectionValid = true;
      showUrlStatus(browser.i18n.getMessage("statusConnectionSuccess"), "success");
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
    renderUploadAuthHint(elements.uploadAuthHintEl, elements.booruUrlInput);
    onStateChange();
  }

  function onApiKeyInput() {
    connectionValid = false;
    onStateChange();
  }

  function requestHostAccessFromUserGesture() {
    const booruUrl = applyNormalizedBooruUrlToInput();

    if (!booruUrl) {
      return;
    }

    let originPattern;

    try {
      originPattern = originPatternFromUrl(booruUrl);
    } catch (e) {
      return;
    }

    if (!originPattern) {
      return;
    }

    const requests = beginHostPermissionRequests([originPattern]);

    if (requests.length === 0) {
      void validateConnection(false);
      return;
    }

    void awaitHostPermissionRequests(requests).then((granted) => {
      if (granted) {
        void validateConnection(false);
        return;
      }

      showPermissionRequiredPrompt();
      onStateChange();
    });
  }

  function bindEvents() {
    // Keep focus on the URL field so blur does not run validateConnection(false) first.
    elements.grantAccessButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    elements.grantAccessButton.addEventListener("click", () => {
      requestHostAccessFromUserGesture();
    });

    elements.booruUrlInput.addEventListener("input", onUrlInput);
    elements.booruUrlInput.addEventListener("blur", () => {
      renderUploadAuthHint(elements.uploadAuthHintEl, elements.booruUrlInput);
      validateConnection(false);
    });

    elements.apiKeyInput.addEventListener("input", onApiKeyInput);
    elements.apiKeyInput.addEventListener("blur", () => {
      validateConnection(false);
    });
  }

  function getSaveData() {
    return {
      id: serverId,
      serverName: elements.friendlyNameInput.value.trim(),
      booruUrl: normalizeBooruUrlInput(elements.booruUrlInput.value),
      apiKey: elements.apiKeyInput.value.trim(),
      rating: elements.ratingInput.value
    };
  }

  function loadValues(entry) {
    const booruUrl = normalizeBooruUrlInput(entry.booruUrl || "");

    elements.friendlyNameInput.value = entry.serverName || "";
    elements.booruUrlInput.value = booruUrl;
    elements.apiKeyInput.value = entry.apiKey || "";
    elements.ratingInput.value = entry.rating || "safe";
    nameFilledForUrl = booruUrl && entry.serverName ? booruUrl : "";
    renderUploadAuthHint(elements.uploadAuthHintEl, elements.booruUrlInput);
  }

  return {
    bindEvents,
    validateConnection,
    canSave,
    getSaveData,
    loadValues
  };
}

function refreshSaveButton() {
  setSaveEnabled([...serverManagers.values()].every((manager) => manager.canSave()));
}

function refreshRemoveButtons() {
  const canRemove = serverManagers.size > 1;
  serversListEl.querySelectorAll(".server-remove").forEach((button) => {
    button.hidden = !canRemove;
  });
}

function removeServerCard(serverId) {
  if (serverManagers.size <= 1) {
    return;
  }

  const card = serversListEl.querySelector(`[data-server-id="${serverId}"]`);
  if (card) {
    card.remove();
  }
  serverManagers.delete(serverId);
  refreshRemoveButtons();
  refreshSaveButton();
}

function addServerCard(entry) {
  const serverId = entry.id;
  const fragment = serverCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".server-card");
  card.dataset.serverId = serverId;

  const elements = {
    friendlyNameInput: card.querySelector(".friendly-name"),
    booruUrlInput: card.querySelector(".booru-url"),
    grantAccessButton: card.querySelector(".grant-access"),
    statusBlockEl: card.querySelector(".server-status-block"),
    urlStatusEl: card.querySelector(".url-status"),
    apiKeyInput: card.querySelector(".api-key"),
    uploadAuthHintEl: card.querySelector(".upload-auth-hint"),
    ratingInput: card.querySelector(".rating")
  };

  localizePage(card);

  const removeButton = card.querySelector(".server-remove");
  removeButton.addEventListener("click", async () => {
    if (await confirmRemoveServerDialog()) {
      removeServerCard(serverId);
    }
  });

  const manager = createServerManager(serverId, elements, refreshSaveButton);
  manager.loadValues(entry);
  manager.bindEvents();
  serverManagers.set(serverId, manager);

  serversListEl.appendChild(card);
  refreshRemoveButtons();

  return manager;
}

addServerButton.addEventListener("click", () => {
  addServerCard(createServerEntry());
  refreshSaveButton();
  const cards = serversListEl.querySelectorAll(".server-card");
  const lastCard = cards[cards.length - 1];
  lastCard?.querySelector(".booru-url")?.focus();
});

saveButton.addEventListener("click", async () => {
  if (serverManagers.size > 0 && ![...serverManagers.values()].every((m) => m.canSave())) {
    return;
  }

  const servers = [...serverManagers.values()].map((manager) => manager.getSaveData());

  saveButton.disabled = true;
  saveButton.classList.remove("saved");

  try {
    await saveServersToStorage(servers);

    saveButton.classList.add("saved");
    saveButton.textContent = browser.i18n.getMessage("buttonSaved");
    showSaveStatus(browser.i18n.getMessage("statusSettingsSaved"), "success");

    window.setTimeout(() => {
      saveButton.classList.remove("saved");
      saveButton.textContent = defaultSaveLabel;
    }, 2000);
  } catch (e) {
    showSaveStatus(browser.i18n.getMessage("errorSaveFailed"), "error");
  } finally {
    refreshSaveButton();
  }
});

async function load() {
  const servers = await getServersFromStorage();

  serversListEl.textContent = "";

  if (servers.length === 0) {
    addServerCard(createServerEntry());
  } else {
    for (const entry of servers) {
      addServerCard(entry);
    }
  }

  refreshRemoveButtons();
  refreshSaveButton();

  for (const manager of serverManagers.values()) {
    const data = manager.getSaveData();
    if (data.booruUrl) {
      await manager.validateConnection(false);
    }
  }

  refreshSaveButton();
}

if (browser.permissions.onAdded) {
  browser.permissions.onAdded.addListener(() => {
    for (const manager of serverManagers.values()) {
      void manager.validateConnection(false);
    }
  });
}

load();
