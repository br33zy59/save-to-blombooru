#!/usr/bin/env node
/**
 * Stage extension files and create ZIP packages for AMO (Firefox) and Chrome Web Store.
 * Source lives under src/; output is build/staging-{firefox,chrome}/ with manifest.json at the archive root.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const buildDir = join(root, "build");

const SHARED_FILES = [
  "browser.js",
  "permissions.js",
  "i18n-ui.js",
  "tab-scripting.js",
  "background.js",
  "auth.js",
  "transfer-history.js",
  "servers.js",
  "media-context.js",
  "options.js",
  "options.html",
  "popup.js",
  "popup.html",
  "icon.png"
];

const SERVICE_WORKER_ENTRY = "background-sw.chrome.js";
const BACKGROUND_MODULES_PATH = "background-modules.firefox.json";

function srcPath(...segments) {
  return join(srcDir, ...segments);
}

function loadBackgroundModuleList() {
  return JSON.parse(readFileSync(srcPath(BACKGROUND_MODULES_PATH), "utf8"));
}

function validateBackgroundModuleList() {
  const modules = loadBackgroundModuleList();

  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error(`${BACKGROUND_MODULES_PATH} must be a non-empty array of script paths.`);
  }

  const swSource = readFileSync(srcPath(SERVICE_WORKER_ENTRY), "utf8");

  for (const file of modules) {
    if (!swSource.includes(`"${file}"`)) {
      throw new Error(
        `${SERVICE_WORKER_ENTRY} must importScripts("${file}") — out of sync with ${BACKGROUND_MODULES_PATH}.`
      );
    }
  }

  for (const file of modules) {
    if (!existsSync(srcPath(file))) {
      throw new Error(`${BACKGROUND_MODULES_PATH} lists missing src file: ${file}`);
    }
  }

  return modules;
}

function applyBackgroundToManifest(manifest, targetName) {
  if (targetName === "firefox") {
    manifest.background = {
      scripts: loadBackgroundModuleList()
    };
    return;
  }

  manifest.background = {
    service_worker: SERVICE_WORKER_ENTRY
  };
}

const TARGETS = {
  firefox: {
    manifest: "manifest.firefox.json",
    zipPrefix: "save-to-blombooru-firefox"
  },
  chrome: {
    manifest: "manifest.chrome.json",
    zipPrefix: "save-to-blombooru-chrome"
  }
};

/** Drop obsolete artifacts from earlier build layouts. */
function cleanLegacyBuildArtifacts() {
  if (!existsSync(buildDir)) {
    return;
  }

  for (const name of readdirSync(buildDir)) {
    const path = join(buildDir, name);
    const isLegacyZip =
      /^save-to-blombooru-\d+\.\d+\.zip$/i.test(name) || name === "test-tar.zip";
    const isLegacyStaging = name === "staging";

    if (isLegacyZip || isLegacyStaging) {
      rmSync(path, { recursive: true, force: true });
      console.log(`Removed legacy build artifact: ${name}`);
    }
  }
}

function cleanBuildDir() {
  rmSync(buildDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  console.log("Removed build/");
}

function validateLocales() {
  const enPath = srcPath("_locales", "en", "messages.json");
  const en = JSON.parse(readFileSync(enPath, "utf8"));
  const enKeys = Object.keys(en).sort();

  for (const locale of ["de", "fr", "es", "pt_BR"]) {
    const path = srcPath("_locales", locale, "messages.json");
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

function validateSharedFiles() {
  for (const file of SHARED_FILES) {
    if (!existsSync(srcPath(file))) {
      throw new Error(`Missing src file listed in SHARED_FILES: ${file}`);
    }
  }
}

function createZip(zipPath, stagingDir) {
  rmSync(zipPath, { force: true });
  mkdirSync(buildDir, { recursive: true });
  execSync(`tar -a -cf "${zipPath}" *`, { cwd: stagingDir, stdio: "inherit" });
}

function buildTarget(targetName) {
  const target = TARGETS[targetName];
  const stagingDir = join(buildDir, `staging-${targetName}`);

  rmSync(stagingDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  mkdirSync(stagingDir, { recursive: true });

  const manifest = JSON.parse(readFileSync(srcPath(target.manifest), "utf8"));
  applyBackgroundToManifest(manifest, targetName);
  writeFileSync(
    join(stagingDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  for (const file of SHARED_FILES) {
    cpSync(srcPath(file), join(stagingDir, file));
  }

  if (targetName === "chrome") {
    cpSync(srcPath(SERVICE_WORKER_ENTRY), join(stagingDir, SERVICE_WORKER_ENTRY));
  }

  cpSync(srcPath("_locales"), join(stagingDir, "_locales"), { recursive: true });

  const zipName = `${target.zipPrefix}-${manifest.version}.zip`;
  const zipPath = join(buildDir, zipName);
  createZip(zipPath, stagingDir);
  console.log(`Created ${zipPath}`);
  console.log(`  ${targetName} dev: Load unpacked → ${stagingDir}`);
}

function main() {
  const args = process.argv.slice(2);

  if (args[0] === "clean") {
    cleanBuildDir();
    return;
  }

  if (!existsSync(srcDir)) {
    throw new Error(`Source directory not found: ${srcDir}`);
  }

  const selected = args.length === 0 ? ["firefox", "chrome"] : args.filter((a) => TARGETS[a]);

  if (selected.length === 0) {
    console.error("Usage: node scripts/build.mjs [firefox] [chrome]");
    console.error("       node scripts/build.mjs clean");
    console.error("  (no args = build both)");
    process.exit(1);
  }

  cleanLegacyBuildArtifacts();
  validateSharedFiles();
  validateLocales();
  validateBackgroundModuleList();

  for (const targetName of selected) {
    buildTarget(targetName);
  }
}

main();
