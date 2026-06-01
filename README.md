# Save to Blombooru

**Right-click to send any web image/video to Blombooru**

A Firefox (or Waterfox/Pale Moon/LibreWolf/Floorp) extension to push media to a [Blombooru](https://github.com/mrblomblo/blombooru) instance while browsing.

---

## Why?

If you already run a self-hosted media library, you know the usual workflow sucks: download the file, open the upload page, pick the file, set a rating, submit. It works, but it takes you right out of the moment.

**Save to Blombooru** keeps you browsing:

- **One gesture** — Right-click → Save to Blombooru.
- **Stay in context** — You’re still on the page you found the media on. Forget about it and carry on browsing.
- **Your infrastructure** — Everything lands on *your* instance, not a third-party host. I mean you could push to someone elses if you like, I guess.
- **Built for local** — point it at `http://blombooru.lan` (or whatever hostname/IP you use internally), grant browser permissions once, and you're good to go.

The toolbar button shows when an upload is in progress, succeeded, or failed, and you'll get a notification if something goes wrong.

---

## Features

| | |
|---|---|
| **Direct upload as you browse** | Right click on images and videos -> (`Save to Blombooru`). |
| **Multiple server support** | Multiple Blombooru servers can be defined separately. Friendly names show up in the menu so you know where things are going. |
| **Connection check** | Settings test your server URL before you can save. |
| **API key support** | Optional API key, if the server requires one. |

---

## Installation

You’ll need:
-  **Firefox** or a derivative (e.g. LibreWolf) that supports extensions.
- An accessible **Blombooru instance**  (reachable via LAN or Internet, just make sure you use HTTPS if it's external).

### 1. Install the extension (development / sideload)

This repo is not yet published on addons.mozilla.org. For now, load it unpacked:

1. Clone or download this repository.
2. In Firefox, open `about:debugging`.
3. Click **This Firefox** → **Load Temporary Add-on…**
4. Choose `manifest.json` from the project folder.

The add-on will only stay loaded for the current Firefox session (typical for temporary add-ons).

### Building a release package (AMO)

From the project root:

```bash
node scripts/build.mjs
```

This validates locale files, stages only extension runtime files, and writes `build/save-to-blombooru-<version>.zip` (ready to upload to [addons.mozilla.org](https://addons.mozilla.org/)). The `build/` directory is git-ignored.

### 2. Configure your Blombooru server(s)

1. Click the extension icon in the toolbar (or open **Add-ons** → **Save to Blombooru** → **Options**).
2. Enter your Blombooru server address (e.g. `http://192.168.0.50:8000` or `https://booru.lan:8000`). This should be the exact same address you use to access your Blombooru in the browser.
3. If Firefox asks for permission to access that host, allow it — the extension only requests access to origins you configure.
4. Wait for **Connection successful**, then **Save Settings**.
5. Optionally set a **friendly name** (shows in the right-click menu) and a **default rating** for content being pushed to the server.

To add a second server, enable **Add alternative server**, fill in the same fields, and save again. You can use this to define a second Blombooru server, or point it to the same address as the first server and use this to push content with a different rating.

### 3. Upload something

1. Right-click an image or video on any site.
2. Choose **Save to Blombooru**.
3. Watch the toolbar badge (if you've added it to your toolbar) for upload status.

If there's a problem pushing the content to Blombooru, you'll get a proper notification alert to let you know.

---

## Project layout

```
save-to-blombooru/
├── manifest.json       # Extension manifest (Firefox MV2)
├── background.js       # Context menu, uploads, notifications
├── servers.js          # Server list storage helpers
├── auth.js             # Blombooru API URLs and connection test
├── media-context.js    # Grabs any alt-text/captions for the selected image/video
├── options.html/js     # Settings UI
├── _locales/           # Language translations (currently added: en, de, fr, es, pt_BR)
└── icon.png            # Extension icon used in browser UI
```

---

## Contributing & license

Issues and pull requests are welcome.

Released under the [MIT License](LICENSE).

---

## Acknowledgements

Built for **[Blombooru](https://github.com/mrblomblo/blombooru)** — a self-hosted, booru-style media library you control. This extension is unofficial and not affiliated with the Blombooru project; names are used to describe compatibility only.

All credit for Blombooru itself sits with [Blombo](https://github.com/mrblomblo) and the maintainers over at the [Blombooru](https://github.com/mrblomblo/blombooru) project page.
