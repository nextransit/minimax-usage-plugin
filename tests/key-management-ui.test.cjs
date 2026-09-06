const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(projectRoot, "src-web", "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(projectRoot, "src-web", "app.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(projectRoot, "src-web", "styles.css"), "utf8");

test("key management modal uses a red top-right close button", () => {
  assert.match(indexHtml, /id="btn-close-modal" class="dialog-close-button"/);
  assert.match(stylesCss, /\.dialog-close-button\s*\{[\s\S]*?right:\s*10px;/);
  assert.match(stylesCss, /\.dialog-close-button\s*\{[\s\S]*?background:\s*#ff2e63;/);
});

test("key management renders multi-key rows as a table with right aligned colored actions", () => {
  assert.match(appJs, /<table class="key-table">/);
  assert.match(appJs, /Name \/ Time/);
  assert.match(appJs, /Key Mask/);
  assert.match(appJs, /Edit \/ Delete/);
  assert.match(appJs, /key-action-button edit js-edit-key/);
  assert.match(appJs, /key-action-button delete js-delete-key/);
  assert.match(stylesCss, /\.key-table-actions\s*\{[\s\S]*?text-align:\s*right;/);
  assert.match(stylesCss, /\.key-action-button\.edit\s*\{[\s\S]*?background:\s*rgba\(0,\s*148,\s*255,\s*0\.78\);/);
  assert.match(stylesCss, /\.key-action-button\.delete\s*\{[\s\S]*?background:\s*rgba\(255,\s*46,\s*99,\s*0\.86\);/);
});

test("edit API key dialog shows masked key data instead of the old empty-key hint", () => {
  assert.doesNotMatch(appJs, /Leave empty to keep current key/);
  assert.match(appJs, /apiKeyInput\.type = 'text';/);
  assert.match(appJs, /apiKeyInput\.value = key\.masked_key \|\| '';/);
  assert.match(appJs, /rawApiKey === maskedKey/);
});
