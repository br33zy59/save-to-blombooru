// Chromium MV3 service worker entry (importScripts chain).
// Firefox/Gecko uses background.scripts from background-modules.firefox.json at build time.
importScripts(
  "browser.js",
  "permissions.js",
  "tab-scripting.js",
  "media-context.js",
  "servers.js",
  "auth.js",
  "transfer-history.js",
  "background.js"
);