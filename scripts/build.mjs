#!/usr/bin/env node
/**
 * Stage extension files and create a ZIP for AMO submission.
 * Archive root contains manifest.json and peers (not a wrapper folder).
 */

import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const stagingDir = join(buildDir, "staging");

const PACKAGED_FILES = [
  "manifest.json",
  "background.js",
  "auth.js",
  "servers.js",
  "media-context.js",
  "options.js",
  "options.html",
  "icon.png"
];

function validateLocales() {
  const enPath = join(root, "_locales", "en", "messages.json");
  const en = JSON.parse(readFileSync(enPath, "utf8"));
  const enKeys = Object.keys(en).sort();

  for (const locale of ["de", "fr", "es", "pt_BR"]) {
    const path = join(root, "_locales", locale, "messages.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    const keys = Object.keys(data).sort();

    const missing = enKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !enKeys.includes(k));

    if (missing.length || extra.length) {
      throw new Error(
        `Locale "${locale}" keys do not match en: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`
      );
    }

    for (const key of enKeys) {
      const enPh = en[key].placeholders;
      const locPh = data[key].placeholders;
      const enPhKeys = enPh ? Object.keys(enPh).sort().join() : "";
      const locPhKeys = locPh ? Object.keys(locPh).sort().join() : "";
      if (enPhKeys !== locPhKeys) {
        throw new Error(`Locale "${locale}" key "${key}" placeholder mismatch`);
      }
    }
  }

  console.log("Locale files OK (5 locales, keys aligned with en).");
}

function stageFiles() {
  rmSync(stagingDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  mkdirSync(stagingDir, { recursive: true });

  for (const file of PACKAGED_FILES) {
    cpSync(join(root, file), join(stagingDir, file));
  }

  cpSync(join(root, "_locales"), join(stagingDir, "_locales"), { recursive: true });
}

function createZip(zipPath) {
  rmSync(zipPath, { force: true });
  mkdirSync(buildDir, { recursive: true });

  // Use tar (not PowerShell Compress-Archive): Windows ZIPs with backslash
  // paths break Firefox locale loading (NS_ERROR_FILE_NOT_FOUND).
  execSync(`tar -a -cf "${zipPath}" *`, { cwd: stagingDir, stdio: "inherit" });
}

function main() {
  validateLocales();
  stageFiles();

  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const zipName = `save-to-blombooru-${manifest.version}.zip`;
  const zipPath = join(buildDir, zipName);

  createZip(zipPath);
  console.log(`Created ${zipPath}`);
}

main();
