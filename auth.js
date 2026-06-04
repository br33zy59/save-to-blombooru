// Blombooru v1.40.0+ accepts API keys on POST /api/media/ (commit a17c3f1, May 2026).
const MIN_BLOOMBOORU_VERSION_FOR_API_KEY_UPLOAD = "1.40.0";

function normalizeApiKey(apiKey) {
  const key = (apiKey || "").trim();
  if (/^bearer\s+/i.test(key)) {
    return key.replace(/^bearer\s+/i, "");
  }
  return key;
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || "").trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isSemverAtLeast(version, minimum) {
  const parts = parseSemver(version);
  const minParts = parseSemver(minimum);
  if (!parts || !minParts) {
    return null;
  }

  for (let i = 0; i < 3; i++) {
    if (parts[i] > minParts[i]) {
      return true;
    }
    if (parts[i] < minParts[i]) {
      return false;
    }
  }

  return true;
}

function appendApiKeyQuery(url, apiKey) {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}api_key=${encodeURIComponent(key)}`;
}

function getAuthHeaders(apiKey) {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    return {};
  }

  return { Authorization: `Bearer ${key}` };
}

function authorizedFetch(url, apiKey, options = {}) {
  const hasApiKey = Boolean(normalizeApiKey(apiKey));
  const authHeaders = getAuthHeaders(apiKey);
  let headers = options.headers;

  if (Object.keys(authHeaders).length > 0) {
    headers = { ...authHeaders, ...(options.headers || {}) };
  }

  const init = { ...options };

  if (headers !== undefined) {
    init.headers = headers;
  }

  if (init.credentials === undefined) {
    // Avoid stale admin cookies overriding a configured API key.
    init.credentials = hasApiKey ? "omit" : "include";
  }

  return fetch(appendApiKeyQuery(url, apiKey), init);
}

function getMediaListUrl(booruUrl) {
  const base = booruUrl.replace(/\/$/, "");
  return `${base}/api/media?limit=1`;
}

function getMediaUploadUrl(booruUrl) {
  const base = booruUrl.replace(/\/$/, "");
  // Trailing slash required — FastAPI returns 405 without it on POST.
  return `${base}/api/media/`;
}

function getMediaItemUrl(booruUrl, mediaId) {
  const base = booruUrl.replace(/\/$/, "");
  return `${base}/api/media/${mediaId}`;
}

function getInstanceInfoUrl(booruUrl) {
  const base = booruUrl.replace(/\/$/, "");
  return `${base}/api/instance-info`;
}

function getApiKeyAuthProbeUrl(booruUrl) {
  const base = booruUrl.replace(/\/$/, "");
  return `${base}/api/admin/api-keys`;
}

async function fetchInstanceInfo(booruUrl) {
  try {
    const response = await fetch(getInstanceInfoUrl(booruUrl));
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function testApiKeyAuthentication(booruUrl, apiKey) {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    return;
  }

  if (!key.startsWith("blom_")) {
    throw new Error(browser.i18n.getMessage("errorApiKeyInvalidFormat"));
  }

  const instanceInfo = await fetchInstanceInfo(booruUrl);
  if (instanceInfo?.app_version) {
    const supported = isSemverAtLeast(
      instanceInfo.app_version,
      MIN_BLOOMBOORU_VERSION_FOR_API_KEY_UPLOAD
    );
    if (supported === false) {
      throw new Error(
        browser.i18n.getMessage(
          "errorApiKeyUploadUnsupportedVersion",
          instanceInfo.app_version
        )
      );
    }
  }

  let response;
  try {
    response = await authorizedFetch(getApiKeyAuthProbeUrl(booruUrl), apiKey);
  } catch (err) {
    throw new Error(browser.i18n.getMessage("errorCouldNotReachServer"));
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(browser.i18n.getMessage("errorAuthFailed"));
  }

  if (!response.ok) {
    throw new Error(
      browser.i18n.getMessage("errorUnexpectedStatus", String(response.status))
    );
  }
}

async function testBlombooruConnection(booruUrl, apiKey) {
  let response;
  try {
    response = await authorizedFetch(getMediaListUrl(booruUrl), apiKey);
  } catch (err) {
    throw new Error(browser.i18n.getMessage("errorCouldNotReachServer"));
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(browser.i18n.getMessage("errorAuthFailed"));
  }

  if (!response.ok) {
    throw new Error(
      browser.i18n.getMessage("errorUnexpectedStatus", String(response.status))
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(browser.i18n.getMessage("errorInvalidJson"));
  }

  if (!Array.isArray(data.items) || typeof data.total !== "number") {
    throw new Error(browser.i18n.getMessage("errorNotBlombooruApi"));
  }

  await testApiKeyAuthentication(booruUrl, apiKey);
}
