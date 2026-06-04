#!/usr/bin/env node
/**
 * Stage extension files and create ZIP packages for AMO (Firefox) and Chrome Web Store.
 * Archive root contains manifest.json and peers (not a wrapper folder).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");

const SHARED_FILES = [
  "browser.js",
  "permissions.js",
  "background.js",
  "auth.js",
  "servers.js",
  "media-context.js",
  "options.js",
  "options.html",
  "icon.png"
];

const TARGETS = {
  firefox: {
    manifest: "manifest.json",
    extraFiles: [],
    zipPrefix: "save-to-blombooru-firefox"
  },
  chrome: {
    manifest: "manifest.chrome.json",
    extraFiles: ["background-sw.js"],
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

  const manifest = JSON.parse(readFileSync(join(root, target.manifest), "utf8"));
  cpSync(join(root, target.manifest), join(stagingDir, "manifest.json"));

  for (const file of SHARED_FILES) {
    cpSync(join(root, file), join(stagingDir, file));
  }

  for (const file of target.extraFiles) {
    cpSync(join(root, file), join(stagingDir, file));
  }

  cpSync(join(root, "_locales"), join(stagingDir, "_locales"), { recursive: true });

  const zipName = `${target.zipPrefix}-${manifest.version}.zip`;
  const zipPath = join(buildDir, zipName);
  createZip(zipPath, stagingDir);
  console.log(`Created ${zipPath}`);
  if (targetName === "chrome") {
    console.log(`  Chrome dev: Load unpacked → ${stagingDir}`);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args[0] === "clean") {
    cleanBuildDir();
    return;
  }

  const selected = args.length === 0 ? ["firefox", "chrome"] : args.filter((a) => TARGETS[a]);

  if (selected.length === 0) {
    console.error("Usage: node scripts/build.mjs [firefox] [chrome]");
    console.error("       node scripts/build.mjs clean");
    console.error("  (no args = build both)");
    process.exit(1);
  }

  cleanLegacyBuildArtifacts();
  validateLocales();

  for (const targetName of selected) {
    buildTarget(targetName);
  }
}

main();
