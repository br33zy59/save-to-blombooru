function originPatternFromUrl(urlString) {
  return new URL(urlString).origin + "/*";
}

function hasInstallTimeBroadHostAccess() {
  const manifest = browser.runtime.getManifest();

  if (manifest.host_permissions?.includes("<all_urls>")) {
    return true;
  }

  return (manifest.permissions || []).includes("<all_urls>");
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
