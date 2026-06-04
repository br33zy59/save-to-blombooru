function buildExecuteScriptCode(func, args) {
  const argList = args.map((arg) => JSON.stringify(arg)).join(", ");
  return argList ? `(${func.toString()})(${argList})` : `(${func.toString()})()`;
}

async function runInTab(tabId, func, args = []) {
  if (tabId < 0) {
    return undefined;
  }

  if (browser.scripting?.executeScript) {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func,
      args
    });
    return results?.[0]?.result;
  }

  // Firefox MV2 tabs.executeScript accepts code or file, not func/args.
  const results = await browser.tabs.executeScript(tabId, {
    code: buildExecuteScriptCode(func, args)
  });
  return results?.[0];
}
