function normalizeTabId(tabId) {
  const id = Number(tabId);

  return Number.isInteger(id) && id >= 0 ? id : -1;
}

async function runInTab(tabId, func, args = []) {
  const normalizedTabId = normalizeTabId(tabId);

  if (normalizedTabId < 0) {
    return undefined;
  }

  const results = await browser.scripting.executeScript({
    target: { tabId: normalizedTabId },
    func,
    args
  });

  return results?.[0]?.result;
}

function base64ToBlob(base64, mimeType = "application/octet-stream") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

function tabPayloadMatchesSrcUrl(tabPayload, srcUrl) {
  if (!tabPayload?.base64 || !srcUrl) {
    return false;
  }

  const probedUrl = tabPayload.probedUrl;
  if (!probedUrl) {
    return false;
  }

  if (probedUrl === srcUrl) {
    return true;
  }

  try {
    const a = new URL(probedUrl);
    const b = new URL(srcUrl);

    return (
      a.hostname === b.hostname &&
      a.pathname === b.pathname &&
      a.search === b.search
    );
  } catch (err) {
    return false;
  }
}

function tabPayloadForSrcUrl(tabPayload, srcUrl) {
  return tabPayloadMatchesSrcUrl(tabPayload, srcUrl) ? tabPayload : null;
}

async function probeTabMediaPayload(tabId, srcUrl) {
  const normalizedTabId = normalizeTabId(tabId);

  if (normalizedTabId < 0 || !srcUrl) {
    return null;
  }

  try {
    const payload = await runInTab(normalizedTabId, extractMediaBlobInPage, [srcUrl]);

    if (!payload?.base64) {
      return null;
    }

    return { ...payload, probedUrl: srcUrl };
  } catch (err) {
    return null;
  }
}
