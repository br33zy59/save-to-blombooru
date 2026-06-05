function buildExecuteScriptCode(func, args) {
  const argList = args.map((arg) => JSON.stringify(arg)).join(", ");
  return argList ? `(${func.toString()})(${argList})` : `(${func.toString()})()`;
}

function normalizeTabId(tabId) {
  const id = Number(tabId);

  return Number.isInteger(id) && id >= 0 ? id : -1;
}

async function runInTab(tabId, func, args = []) {
  const normalizedTabId = normalizeTabId(tabId);

  if (normalizedTabId < 0) {
    return undefined;
  }

  if (browser.scripting?.executeScript) {
    const results = await browser.scripting.executeScript({
      target: { tabId: normalizedTabId },
      func,
      args
    });
    return results?.[0]?.result;
  }

  // Firefox MV2 tabs.executeScript accepts code or file, not func/args.
  const results = await browser.tabs.executeScript(normalizedTabId, {
    code: buildExecuteScriptCode(func, args)
  });
  return results?.[0];
}
