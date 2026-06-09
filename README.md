# Save to Blombooru

**Quickly save any web image/video to your personal booru**

A **Firefox** and **Chrome** extension to push media to a [Blombooru](https://github.com/mrblomblo/blombooru) instance while browsing the web.

## Features

- Easy right-click 'Save to Blombooru' functionality

  ![Screenshot of the extension context menu with a single server definition](assets/readme_ss3.png)

- Fast handling of multiple servers and content ratings (configurable)

  ![Screenshot of the extension context menu with multiple server definitions](assets/readme_ss2.png) 

- Simple gallery listing for all media items on the current web page, with easy upload to blombooru

  ![Screenshot of the 'page gallery' feature](assets/readme_ss1.png)

- Thumbnail detection - Where thumbnails link to a full-size image or video, you will be offered an option to upload the full item.

## Install

Prerequisites:

- **Firefox**, **Chrome**, or a derivative (e.g. Edge, LibreWolf) that supports extensions.
- A working **Blombooru** installation on your LAN or reachable over the Internet.

Click the appropriate link below to install for your browser:

[![Install on Chrome](https://img.shields.io/badge/Install%20on-Chrome-4285F4?logo=googlechrome&logoColor=white&style=for-the-badge)](https://chromewebstore.google.com/detail/mhnaejinolnamebgpomkpbmdhjhnhlji)

[![Install on Firefox](https://img.shields.io/badge/Install%20on-Firefox-FF7139?logo=firefoxbrowser&logoColor=white&style=for-the-badge)](https://addons.mozilla.org/en-US/firefox/addon/save-to-blombooru@foo/)

### Configure servers

1. Click the toolbar icon and select **settings** (or navigate to your browser's **Add-ons** menu → **Save to Blombooru** → **Options**).
2. Enter your Blombooru URL (same address that you use to access it, e.g. `http://192.168.0.50:8000`).
3. You may be prompted to allow host access to the blombooru server. This is necessary for the extension to function.
4. Wait for **Connection successful**, then **Save Settings**.
5. Optionally set a **friendly name** (right-click menu) and **default rating**.

If you do not use an API key, log into the Blombooru admin UI once in the same browser profile so session cookies are available for uploads.

To add another server, use **Add another server**, then save.

## Using the extension

1. Right-click an image or video on a web page.
2. Choose **Save to Blombooru**.

Alternative usage:

1. Select the extension icon on the toolbar
2. A gallery will appear showing all media on the current page
3. Click the items you wish to push to your booru

**Note:** Media items on the current page will save to your booru immediately. Downstream 'full' images and videos that are linked via thumbnails may prompt for permission to access the remote website. Once this has been allowed, it will remain valid for any other content served from the same web host.

## Development / Sideload Install

Clone or download this repository.

**Firefox or Chrome**

Build/stage before loading (you need **node** and **tar** at the command line):

```
node scripts/build.mjs firefox   # or: chrome
```

1. **Firefox / LibreWolf:** `about:debugging` → **This Firefox** → **Load Temporary Add-on…** → choose `build/staging-firefox/manifest.json`. Requires **Firefox 140+** (uses `background.scripts`).
2. **Chrome / Edge:** `chrome://extensions` or `edge://extensions` → **Developer mode** → **Load unpacked** → `build/staging-chrome` (Chrome 121+; uses `background-sw.chrome.js` service worker).

After changing background or popup code, run the build again and reload the extension.

Note: Temporary loads do not persist across browser restarts.

Both builds use **`activeTab`** plus **optional** host access (`http://*/*`, `https://*/*`), prompted when you configure your Blombooru URL in options or on first upload to a new origin. Neither build requests `<all_urls>` at install time.

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
├── scripts/build.mjs       # Stage src/ → build/staging-* and ZIP packages
├── build/                  # gitignored: staging dirs and release ZIPs
└── src/
    ├── manifest.firefox.json
    ├── manifest.chrome.json
    ├── background-modules.firefox.json  # Firefox script order (injected at build)
    ├── background-sw.chrome.js          # Chromium service worker entry
    ├── browser.js                       # browser/chrome shim
    ├── background.js                    # Context menu, uploads, notifications
    ├── auth.js                          # API auth and connection test
    ├── servers.js                       # Multi-server storage
    ├── permissions.js                   # Host permissions, upload prep
    ├── media-context.js                 # Injected page scripts (caption, gallery)
    ├── options.html / options.js
    ├── popup.html / popup.js            # Toolbar popup and page media gallery
    ├── tab-scripting.js
    ├── i18n-ui.js
    ├── _locales/                        # en, de, fr, es, pt_BR
    └── icon.png
```

The build writes a single `manifest.json` into each staging directory (background section merged from the platform entrypoints above).

## Contributing & license

Issues and pull requests are welcome.

Released under the [MIT License](LICENSE).

## Acknowledgements

Built for **[Blombooru](https://github.com/mrblomblo/blombooru)** — a self-hosted, booru-style media library you control. This extension is unofficial and not affiliated with the Blombooru project; names are used to describe compatibility only.

All credit for Blombooru itself sits with [Blombo](https://github.com/mrblomblo) and the maintainers at the [Blombooru](https://github.com/mrblomblo/blombooru) project.
