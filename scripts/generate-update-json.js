#!/usr/bin/env node
/**
 * Generate update.json for Tauri v2 auto-update.
 *
 * Run inside the GitHub Actions `release` job after artifacts are uploaded.
 * Reads environment variables set by GitHub Actions.
 *
 * Usage:
 *   node scripts/generate-update-json.js
 *
 * Output:
 *   update.json (in working directory)
 */

const fs = require("fs");
const path = require("path");

// ── Platform artifact filename patterns ──────────────────────────────────

const PLATFORM_MAP = [
  {
    platform: "darwin-aarch64",
    artifactGroup: "macos-arm64",
    glob: /_aarch64\.app\.tar\.gz$/,
  },
  {
    platform: "darwin-x86_64",
    artifactGroup: "macos-x64",
    glob: /_x64\.app\.tar\.gz$/,
  },
  {
    platform: "linux-x86_64",
    artifactGroup: "linux-x64",
    glob: /MiniMax\.Monitor_.*_amd64\.AppImage$/,
  },
  {
    platform: "windows-x86_64",
    artifactGroup: "windows-x64",
    glob: /MiniMax\.Monitor_.*_x64-setup\.exe$/,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function getVersion() {
  const tag = process.env.GITHUB_REF_NAME || "";
  return tag.replace(/^v/, "");
}

function getRepo() {
  return process.env.GITHUB_REPOSITORY || "nextransit/minimax-usage-plugin";
}

function getTag() {
  return process.env.GITHUB_REF_NAME || "";
}

/**
 * Walk the artifacts directory and find matching files per platform.
 */
function findArtifacts(artifactsDir) {
  const results = {};

  function walk(dir, matches, pattern) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, matches, pattern);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        matches.push(fullPath);
      }
    }
  }

  for (const platform of PLATFORM_MAP) {
    const matches = [];
    walk(
      path.join(artifactsDir, platform.artifactGroup),
      matches,
      platform.glob,
    );

    if (matches.length > 1) {
      throw new Error(
        `Multiple updater artifacts found for ${platform.platform}: ${matches.join(", ")}`,
      );
    }
    if (matches.length === 0) continue;

    const artifactPath = matches[0];
    const signaturePath = `${artifactPath}.sig`;
    if (!fs.existsSync(signaturePath)) {
      throw new Error(`Missing updater signature for ${artifactPath}`);
    }

    const signature = fs.readFileSync(signaturePath, "utf8").trim();
    if (!signature) {
      throw new Error(`Updater signature is empty for ${artifactPath}`);
    }

    results[platform.platform] = {
      fileName: path.basename(artifactPath),
      signature,
    };
  }

  return results;
}

/**
 * Extract release notes for current version from CHANGELOG.md.
 */
function getReleaseNotes(version) {
  const changelogPath = path.join(process.cwd(), "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) return "";

  const content = fs.readFileSync(changelogPath, "utf8");
  const lines = content.split("\n");
  const versionHeader = `## ${version}`;

  let inSection = false;
  let notes = [];

  for (const line of lines) {
    if (line.startsWith(versionHeader)) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) {
      break;
    }
    if (inSection) {
      notes.push(line);
    }
  }

  return notes.join("\n").trim();
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const version = getVersion();
  const repo = getRepo();
  const tag = getTag();
  const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;

  if (!version) {
    console.error("Error: Could not determine version from GITHUB_REF_NAME");
    process.exit(1);
  }

  console.log(`Version: ${version}`);
  console.log(`Repo: ${repo}`);
  console.log(`Tag: ${tag}`);
  console.log(`Base URL: ${baseUrl}`);

  // Find artifacts in the artifacts directory (uploaded by download-artifact action)
  const artifactsDir = path.join(process.cwd(), "artifacts");
  const found = findArtifacts(artifactsDir);

  console.log("Found artifacts:", JSON.stringify(found, null, 2));

  const missingPlatforms = PLATFORM_MAP
    .map((platform) => platform.platform)
    .filter((platform) => !found[platform]);
  if (missingPlatforms.length > 0) {
    throw new Error(`Missing updater artifacts for: ${missingPlatforms.join(", ")}`);
  }

  const platforms = {};
  for (const p of PLATFORM_MAP) {
    const artifact = found[p.platform];
    platforms[p.platform] = {
      url: `${baseUrl}/${encodeURIComponent(artifact.fileName)}`,
      signature: artifact.signature,
    };
    console.log(`  ${p.platform}: ${artifact.fileName}`);
  }

  const notes = getReleaseNotes(version);

  const updateJson = {
    version,
    notes: notes || `MiniMax Monitor v${version}`,
    pub_date: new Date().toISOString(),
    platforms,
  };

  const outputPath = path.join(process.cwd(), "update.json");
  fs.writeFileSync(outputPath, JSON.stringify(updateJson, null, 2) + "\n");

  console.log(`\nupdate.json written to ${outputPath}`);
  console.log(JSON.stringify(updateJson, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
