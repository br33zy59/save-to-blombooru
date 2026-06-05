// Chromium MV3 service worker entry (importScripts chain).
// Firefox/Gecko uses background.scripts in the manifest (see background-modules.json).
importScripts(
  "browser.js",
  "permissions.js",
  "tab-scripting.js",
  "media-context.js",
  "servers.js",
  "auth.js",
  "background.js"
);