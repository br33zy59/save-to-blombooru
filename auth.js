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

async function testBlombooruConnection(booruUrl) {
  let response;
  try {
    response = await fetch(getMediaListUrl(booruUrl));
  } catch (err) {
    throw new Error("Could not reach the server. Check the address and try again.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "This Blombooru instance requires authentication. Use an instance without API auth for now."
    );
  }

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}. This may not be a Blombooru instance.`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error("Server response was not valid JSON.");
  }

  if (!Array.isArray(data.items) || typeof data.total !== "number") {
    throw new Error("Response does not look like a Blombooru API.");
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
