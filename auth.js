// No-auth Blombooru instances only (REQUIRE_AUTH off).
// API key support disabled until Blombooru fixes upstream — see commented stubs below.

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

async function testBlombooruConnection(booruUrl) {
  let response;
  try {
    response = await fetch(getMediaListUrl(booruUrl));
  } catch (err) {
    throw new Error(browser.i18n.getMessage("errorCouldNotReachServer"));
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(browser.i18n.getMessage("errorAuthRequiredInstance"));
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
}

// --- API key support (disabled until Blombooru upstream fix) ---
// function normalizeApiKey(apiKey) {
//   const key = (apiKey || "").trim();
//   if (/^bearer\s+/i.test(key)) {
//     return key.replace(/^bearer\s+/i, "");
//   }
//   return key;
// }
//
// function appendApiKeyQuery(url, apiKey) {
//   const key = normalizeApiKey(apiKey);
//   if (!key) return url;
//   const separator = url.includes("?") ? "&" : "?";
//   return `${url}${separator}api_key=${encodeURIComponent(key)}`;
// }
//
// function getMediaListUrl(booruUrl, apiKey) {
//   const base = booruUrl.replace(/\/$/, "");
//   return appendApiKeyQuery(`${base}/api/media?limit=1`, apiKey);
// }
//
// function getMediaUploadUrl(booruUrl, apiKey) {
//   const base = booruUrl.replace(/\/$/, "");
//   return appendApiKeyQuery(`${base}/api/media/`, apiKey);
// }
