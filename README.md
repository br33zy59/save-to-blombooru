# Save to Blombooru

**Right-click to send any image/video to your Blombooru**

A **Firefox** and **Chrome** extension to push media to a [Blombooru](https://github.com/mrblomblo/blombooru) instance while browsing the web.


## Install

You'll need:

- **Firefox**, **Chrome**, or a derivative (e.g. Edge, LibreWolf) that supports extensions.
- A working **Blombooru** installation on your LAN or reachable over the Internet.

Click the appropriate extension icon below to install for your browser:
- **addons.mozilla.org approval pending**
- **Chrome Web Store approval pending**

### Configure Blombooru

1. Click the extension icon (or **Add-ons** → **Save to Blombooru** → **Options**).
2. Enter your Blombooru URL (same origin you use in the browser, e.g. `http://192.168.0.50:8000`).
3. Grant host access if prompted.
4. Wait for **Connection successful**, then **Save Settings**.
5. Optionally set a **friendly name** (right-click menu) and **default rating**.

If you do not use an API key, log into the Blombooru admin UI once in the same browser profile so session cookies are available for uploads.

To add another server, use **Add another server**, then save.

## Upload

1. Right-click an image or video.
2. Choose **Save to Blombooru**.
3. Watch the toolbar badge for status.

Failed uploads show a notification with the error.

---

## Development / Sideload Install

Clone or download this repository.

**Firefox**

You can just load the extension directly from the repository folder:

1. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on…**
2. Choose `manifest.json` in the project folder.

**Chrome**

You need to build/stage before you can load the extension. You'll need **node** (node.js) and **tar** available at the command line.

1. From a terminal session within the repository folder, run:
    ```
    node scripts/build.mjs chrome
    ```

2. Open `chrome://extensions` (or `edge://extensions` in Edge), enable **Developer mode**.
3. **Load unpacked** → select `build/staging-chrome` (not the repo root).

After changing popup or background code, run `node scripts/build.mjs chrome` again and click **Reload** on the extension card.

Note: Temporary extension loads like these do not persist across browser restarts.

The Chrome build uses `activeTab` plus **optional** host access (prompted for your Blombooru URL in options and on first upload). It does not request `<all_urls>` at install time. Firefox keeps broad host access in its manifest.

### Building packages

Running the build script will different parameters will produce different outputs:

```
node scripts/build.mjs          # Produces Firefox + Chrome ZIPs
node scripts/build.mjs firefox  # Produces Firefox ZIP (for AMO only)
node scripts/build.mjs chrome   # Produces Chrome ZIP (for Chrome Web Store only)
node scripts/build.mjs clean    # remove build/
```

Outputs (version from manifest):

- `build/save-to-blombooru-firefox-<version>.zip` — [addons.mozilla.org](https://addons.mozilla.org/)
- `build/save-to-blombooru-chrome-<version>.zip` — Chrome Web Store

The `build/` directory is git-ignored. ZIPs use `tar` so paths use forward slashes (required by Firefox).

## Project layout

```
save-to-blombooru/
├── manifest.json          # Firefox MV2 (dev + AMO build)
├── manifest.chrome.json   # Chrome MV3 (build only → staging-chrome/manifest.json)
├── background-sw.js       # Chrome service worker entry (importScripts chain)
├── browser.js             # browser/chrome shim
├── background.js          # Context menu, uploads, notifications
├── auth.js                # API auth and connection test
├── servers.js             # Multi-server storage
├── permissions.js         # Optional host permission helper
├── media-context.js       # Caption extraction (injected)
├── options.html / options.js
├── popup.html / popup.js   # Toolbar menu (settings, server links, page media gallery)
├── tab-scripting.js        # Shared tab script injection helper
├── scripts/build.mjs
├── _locales/              # en, de, fr, es, pt_BR
└── icon.png
```

---

## Contributing & license

Issues and pull requests are welcome.

Released under the [MIT License](LICENSE).

---

## Acknowledgements

Built for **[Blombooru](https://github.com/mrblomblo/blombooru)** — a self-hosted, booru-style media library you control. This extension is unofficial and not affiliated with the Blombooru project; names are used to describe compatibility only.

All credit for Blombooru itself sits with [Blombo](https://github.com/mrblomblo) and the maintainers at the [Blombooru](https://github.com/mrblomblo/blombooru) project.
