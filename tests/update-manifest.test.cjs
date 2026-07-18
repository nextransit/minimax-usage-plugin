const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const generatorPath = path.join(projectRoot, "scripts", "generate-update-json.js");

test("update manifest uses signed updater artifacts instead of installers", (t) => {
  const fixture = createReleaseFixture(t);
  const result = runGenerator(fixture);

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture, "update.json"), "utf8"),
  );
  assert.equal(manifest.version, "0.0.17");
  assert.match(manifest.notes, /signed updater release/);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
    "windows-x86_64",
  ]);
  assert.match(
    manifest.platforms["darwin-aarch64"].url,
    /MiniMax\.Monitor_0\.0\.17_aarch64\.app\.tar\.gz$/,
  );
  assert.equal(manifest.platforms["darwin-aarch64"].signature, "mac-arm-signature");
  assert.match(
    manifest.platforms["darwin-x86_64"].url,
    /MiniMax\.Monitor_0\.0\.17_x64\.app\.tar\.gz$/,
  );
  assert.equal(manifest.platforms["darwin-x86_64"].signature, "mac-x64-signature");
  assert.equal(manifest.platforms["linux-x86_64"].signature, "linux-signature");
  assert.equal(manifest.platforms["windows-x86_64"].signature, "windows-signature");
});

test("update manifest generation fails when an updater signature is missing", (t) => {
  const fixture = createReleaseFixture(t);
  fs.unlinkSync(
    path.join(
      fixture,
      "artifacts",
      "macos-arm64",
      "MiniMax.Monitor_0.0.17_aarch64.app.tar.gz.sig",
    ),
  );

  const result = runGenerator(fixture);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /signature/i);
});

test("Tauri and release workflow require signed updater artifacts", () => {
  const tauriConfig = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const workflow = fs.readFileSync(
    path.join(projectRoot, ".github", "workflows", "release-desktop.yml"),
    "utf8",
  );
  const commands = fs.readFileSync(
    path.join(projectRoot, "src-tauri", "src", "commands.rs"),
    "utf8",
  );

  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
  assert.ok(tauriConfig.plugins.updater.pubkey);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*""/);
  assert.doesNotMatch(workflow, /tauri:build:ci/);
  assert.match(workflow, /\.app\.tar\.gz/);
  assert.match(workflow, /\.sig/);
  assert.match(commands, /app\.restart\(\)/);
  assert.doesNotMatch(commands, /cmd_restart_app[\s\S]*?app\.exit\(0\)/);
});

function createReleaseFixture(t) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-update-manifest-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  writeArtifact(
    fixture,
    "macos-arm64",
    "MiniMax.Monitor_0.0.17_aarch64.app.tar.gz",
    "mac-arm-signature",
  );
  writeArtifact(
    fixture,
    "macos-x64",
    "MiniMax.Monitor_0.0.17_x64.app.tar.gz",
    "mac-x64-signature",
  );
  writeArtifact(
    fixture,
    "linux-x64",
    "MiniMax.Monitor_0.0.17_amd64.AppImage",
    "linux-signature",
  );
  writeArtifact(
    fixture,
    "windows-x64",
    "MiniMax.Monitor_0.0.17_x64-setup.exe",
    "windows-signature",
  );

  fs.writeFileSync(
    path.join(fixture, "CHANGELOG.md"),
    "# Changelog\n\n## 0.0.17\n\n- signed updater release\n",
  );

  return fixture;
}

function writeArtifact(fixture, artifactGroup, fileName, signature) {
  const dir = path.join(fixture, "artifacts", artifactGroup);
  fs.mkdirSync(dir, { recursive: true });
  const artifactPath = path.join(dir, fileName);
  fs.writeFileSync(artifactPath, "artifact");
  fs.writeFileSync(`${artifactPath}.sig`, `${signature}\n`);
}

function runGenerator(cwd) {
  return spawnSync(process.execPath, [generatorPath], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REF_NAME: "v0.0.17",
      GITHUB_REPOSITORY: "nextransit/minimax-usage-plugin",
    },
  });
}
