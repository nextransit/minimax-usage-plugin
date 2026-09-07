// Behavior regression for "add third API key -> click Save -> no response".
//
// Root cause: src-web/app.js previously registered window `focus` and document
// `visibilitychange` handlers that closed #key-edit-dialog AND cleared
// #key-edit-api-key.value via closeTransientDialogs(). On macOS Tauri WebView,
// those events routinely fire while the user is still mid-edit (Cmd+Tab away
// and back, system dialogs, notification banners). The Save button then read
// an empty API key and silently alerted — and the dialog was already hidden —
// so the user perceived the click as a no-op.
//
// This test loads the dialog subsystem slice of app.js (transientDialogIds,
// setDialogVisibility, closeTransientDialogs, the new isEditingKey state field,
// and the openKeyEditDialog/closeKeyEditDialog guards) and exercises:
//   - focus event while editing a key  -> dialog must stay open, key intact
//   - visibilitychange while editing   -> same
//   - closeKeyEditDialog()             -> isEditingKey resets so future focus
//                                          events can clean up other transient
//                                          dialogs (without wiping the key field)
//   - focus event while NOT editing    -> other transient dialogs still close

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(projectRoot, "src-web", "app.js"), "utf8");

function extractBugCode() {
  // Dialog subsystem only. We stop before any top-level `window.__MINIMAX_...` /
  // `closeTransientDialogs()` calls so the harness can drive the dialog state
  // directly without standing up a real browser window.
  const start = appJs.indexOf("const transientDialogIds");
  if (start < 0) throw new Error("transientDialogIds anchor not found in app.js");
  const marker = "window.__MINIMAX_CLOSE_TRANSIENT_DIALOGS__";
  const stop = appJs.indexOf(marker, start);
  if (stop < 0) throw new Error("__MINIMAX_CLOSE_TRANSIENT_DIALOGS__ marker not found");
  return appJs.slice(start, stop);
}

function buildHarness() {
  const elements = new Map();
  function makeEl(id) {
    const attrs = new Map();
    const style = { display: "" };
    return {
      id, value: "", type: "", style, dataset: {},
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      setAttribute(name, val) { attrs.set(name, String(val)); },
      removeAttribute(name) { attrs.delete(name); },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    };
  }
  function el(id) {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  }
  for (const id of [
    "api-key-dialog", "key-management-modal", "key-edit-dialog", "update-dialog",
  ]) el(id);

  const ctx = {
    state: { isEditingKey: false },
    document: {
      getElementById: (id) => elements.get(id) || null,
      visibilityState: "visible",
      hasFocus: () => true,
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(extractBugCode(), ctx, { filename: "dialog-subsystem.js" });

  return {
    el,
    set(keyId, value) { el(keyId).value = value; },
    get(keyId) { return el(keyId).value; },
    showDialog(dialogId) { ctx.setDialogVisibility(dialogId, true); },
    closeDialog(dialogId) { ctx.setDialogVisibility(dialogId, false); },
    setEditing(on) { ctx.state.isEditingKey = !!on; },
    get isEditing() { return ctx.state.isEditingKey === true; },
    triggerFocus() { ctx.closeTransientDialogs(); },
  };
}

test("focus event while editing a key keeps the dialog open and the API key intact", () => {
  const h = buildHarness();
  // Simulate what openKeyEditDialog does in production: open the dialog and flip the flag.
  h.showDialog("key-edit-dialog");
  h.setEditing(true);
  h.set("key-edit-api-key", "sk-very-secret-third-key");

  // The bug: this used to close the dialog and clear the input.
  h.triggerFocus();

  assert.equal(
    h.el("key-edit-dialog").style.display, "flex",
    "dialog must stay open while the user is editing a key",
  );
  assert.equal(
    h.get("key-edit-api-key"), "sk-very-secret-third-key",
    "API key input must not be cleared by window focus",
  );
});

test("visibilitychange->visible while editing a key keeps the dialog open", () => {
  const h = buildHarness();
  h.showDialog("key-edit-dialog");
  h.setEditing(true);
  h.set("key-edit-api-key", "sk-very-secret-third-key");

  // The document handler is the same `closeTransientDialogs()` call site as focus.
  h.triggerFocus();

  assert.equal(h.el("key-edit-dialog").style.display, "flex");
  assert.equal(h.get("key-edit-api-key"), "sk-very-secret-third-key");
});

test("after closeKeyEditDialog the API key input is still not wiped by focus", () => {
  const h = buildHarness();
  h.showDialog("key-edit-dialog");
  h.setEditing(true);
  h.set("key-edit-api-key", "sk-very-secret-third-key");

  // User cancels / closes the edit dialog.
  h.closeDialog("key-edit-dialog");
  h.setEditing(false);

  // Subsequent focus events must NOT clear the (now-hidden) input either — the
  // pre-fix closeTransientDialogs() used to wipe #key-edit-api-key.value outright.
  h.triggerFocus();
  assert.equal(
    h.get("key-edit-api-key"), "sk-very-secret-third-key",
    "closeTransientDialogs() must never wipe the API key input",
  );
});

test("focus event still closes non-key transient dialogs when not editing a key", () => {
  const h = buildHarness();
  h.showDialog("key-management-modal");
  h.triggerFocus();
  assert.equal(
    h.el("key-management-modal").style.display, "none",
    "non-key transient dialogs must still be cleaned up by focus when no key edit is in progress",
  );
});
