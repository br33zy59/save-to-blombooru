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
