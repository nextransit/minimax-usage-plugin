const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(projectRoot, "src-web", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(projectRoot, "src-web", "index.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(projectRoot, "src-web", "styles.css"), "utf8");

test("aggregate metrics sum each visible key exactly once", () => {
  const harness = createAggregateHarness();
  const metrics = harness.api.getAggregateMetrics();

  assert.equal(metrics.used, 60);
  assert.equal(metrics.remaining, 240);
  assert.equal(metrics.total, 300);
  assert.equal(metrics.weeklyUsed, 600);
  assert.equal(metrics.weeklyRemaining, 2400);
  assert.equal(metrics.weeklyTotal, 3000);
  assert.equal(metrics.hasData, true);
});

test("ALL view current and weekly progress widths change when aggregate usage changes", () => {
  const harness = createAggregateHarness();

  harness.api.renderAggregateView();
  const initialCurrentWidth = harness.el("current-progress").style.width;
  const initialWeeklyWidth = harness.el("weekly-progress").style.width;

  assert.equal(initialCurrentWidth, "20%");
  assert.equal(initialWeeklyWidth, "20%");
  assert.equal(harness.el("current-percent").textContent, "20%");
  assert.equal(harness.el("weekly-percent").textContent, "20%");
  assert.equal(harness.el("weekly-progress").className, "progress-thumb secondary normal");

  harness.context.state.usageData.keyA = makeUsage({
    used: 80,
    total: 100,
    weeklyUsed: 1200,
    weeklyTotal: 2000,
    lastUpdated: "2026-05-16 12:01:00",
  });
  harness.api.renderAggregateView();

  const nextCurrentWidth = harness.el("current-progress").style.width;
  const nextWeeklyWidth = harness.el("weekly-progress").style.width;

  assert.notEqual(nextCurrentWidth, initialCurrentWidth);
  assert.notEqual(nextWeeklyWidth, initialWeeklyWidth);
  assert.equal(nextCurrentWidth, "40%");
  assert.ok(Math.abs(parseFloat(nextWeeklyWidth) - 53.3333333333) < 0.0001);
  assert.equal(harness.el("current-percent").textContent, "40%");
  assert.equal(harness.el("weekly-percent").textContent, "53%");
});

test("current remaining display shows the capped current remaining (no weekly mix-in)", () => {
  const harness = createAggregateHarness();

  harness.api.renderAggregateView();

  // keyA: min(80, 1800) = 80; keyB: min(160, 600) = 160 => 240
  assert.equal(harness.el("current-remaining").textContent, "240");
  assert.equal(harness.el("current-remaining").dataset.source, "current");
  assert.equal(harness.el("current-remaining-wrapper").dataset.source, "current");
});

test("current remaining respects per-key hard cap (current <= weekly remaining)", () => {
  const harness = createAggregateHarness();
  harness.context.state.usageData.keyA = makeUsage({
    used: 20,
    total: 2000,
    weeklyUsed: 900,
    weeklyTotal: 1000,
    lastUpdated: "2026-05-16 12:01:00",
  });
  harness.context.state.usageData.keyB = makeUsage({
    used: 40,
    total: 2000,
    weeklyUsed: 900,
    weeklyTotal: 1000,
    lastUpdated: "2026-05-16 12:01:30",
  });

  harness.api.renderAggregateView();

  // keyA: min(1980, 100) = 100; keyB: min(1960, 100) = 100 => 200
  assert.equal(harness.el("current-remaining").textContent, "200");
  assert.equal(harness.el("current-remaining").dataset.source, "current");
  assert.equal(harness.el("current-remaining-wrapper").dataset.source, "current");
});

test("weekly-sourced current remaining has a distinct color", () => {
  const valueBlock = extractCssBlock(stylesCss, ".data-value.remaining-breath.weekly-source");
  const wrapperBlock = extractCssBlock(stylesCss, ".breathing-metric.weekly-source");

  assert.match(valueBlock, /color:\s*var\(--secondary\);/);
  assert.match(wrapperBlock, /--breath-color:\s*var\(--secondary\);/);
  assert.match(wrapperBlock, /--breath-rgb:\s*168,\s*85,\s*247;/);
});

test("percentFromUsage prefers backend percent fields and falls back to counts", () => {
  const harness = createAggregateHarness();

  assert.equal(
    harness.api.percentFromUsage(
      { ok: true, used_count: 10, total_count: 100, used_percent: 25 },
      "used_count",
      "total_count",
      "used_percent",
    ),
    25,
  );
  assert.equal(
    harness.api.percentFromUsage(
      { ok: true, used_count: 15, total_count: 60, used_percent: null },
      "used_count",
      "total_count",
      "used_percent",
    ),
    25,
  );
});

test("API key breakdown rows bind the visible bar to the same percent as the text", () => {
  const harness = createBreakdownHarness();
  const html = harness.api.renderKeyDetailCard({
    id: "keyA",
    name: "Key A",
    color: "#22c55e",
    masked_key: "sk-abc...1234",
    refresh_interval: 20,
    is_active: true,
  });

  assert.match(html, /style="--metric-scale: 0\.2500;"/);
  assert.match(html, /style="--metric-scale: 0\.7500;"/);
  assert.match(html, /<span class="metric-pct">25%<\/span>/);
  assert.match(html, /<span class="metric-pct">75%<\/span>/);
  assert.doesNotMatch(html, /metric-bar-fill" style=/);
  assert.doesNotMatch(html, /background:\s*lime/);
});

test("breakdown progress CSS uses transform scale instead of inline width fills", () => {
  const fillBlock = extractCssBlock(stylesCss, ".breakdown-metric-row .metric-bar-fill");
  assert.match(fillBlock, /width:\s*100%;/);
  assert.match(fillBlock, /transform:\s*scaleX\(var\(--metric-scale,\s*0\)\);/);
  assert.doesNotMatch(fillBlock, /width:\s*0%;/);
  assert.match(stylesCss, /\.breakdown-shimmer \.metric-bar-fill\s*\{[\s\S]*?transform:\s*scaleX\(1\);/);
});

test("aggregate progress render path has no temporary debug UI leftovers", () => {
  assert.doesNotMatch(appJs, /debug-info/);
  assert.doesNotMatch(appJs, /debug-panel/);
  assert.doesNotMatch(appJs, /showDebugPanel/);
  assert.doesNotMatch(appJs, /\[DEBUG\]/);
  assert.doesNotMatch(appJs, /background:\s*lime/);
  assert.doesNotMatch(appJs, /getComputedStyle/);
  assert.doesNotMatch(appJs, /setAttribute\('style'/);
  assert.doesNotMatch(appJs, /\[renderAggregateView\]/);
  assert.doesNotMatch(appJs, /\[getAggregateMetrics\]/);
  assert.doesNotMatch(appJs, /\[updateProgressBar\]/);
});

function createAggregateHarness() {
  const elements = new Map();

  function el(id) {
    if (!elements.has(id)) {
      const attrs = new Map();
      const element = {
        id,
        className: initialClassName(id),
        style: { width: id.endsWith("progress") ? "0%" : "", display: "" },
        textContent: "",
        dataset: {},
        classList: {
          contains(name) {
            return element.className.split(/\s+/).includes(name);
          },
        },
        getAttribute(name) {
          return attrs.has(name) ? attrs.get(name) : null;
        },
        setAttribute(name, value) {
          attrs.set(name, String(value));
        },
      };
      elements.set(id, element);
    }
    return elements.get(id);
  }

  const documentElementStyle = {
    removed: [],
    removeProperty(name) {
      this.removed.push(name);
    },
  };

  const context = {
    console,
    state: {
      apiKeys: [
        { id: "keyA", name: "Key A", is_active: true },
        { id: "keyB", name: "Key B", is_active: true },
        { id: "hidden", name: "Hidden", is_active: false },
      ],
      usageData: {
        keyA: makeUsage({
          used: 20,
          total: 100,
          weeklyUsed: 200,
          weeklyTotal: 2000,
          lastUpdated: "2026-05-16 12:00:00",
        }),
        keyB: makeUsage({
          used: 40,
          total: 200,
          weeklyUsed: 400,
          weeklyTotal: 1000,
          lastUpdated: "2026-05-16 12:00:30",
        }),
        hidden: makeUsage({
          used: 100,
          total: 100,
          weeklyUsed: 1000,
          weeklyTotal: 1000,
          lastUpdated: "2026-05-16 12:00:45",
        }),
      },
      lastError: "",
      isLoading: false,
      language: "zh-CN",
    },
    document: {
      documentElement: { style: documentElementStyle },
      getElementById: el,
      createElement() {
        throw new Error("aggregate render should not create temporary debug elements");
      },
      body: {
        appendChild() {
          throw new Error("aggregate render should not append temporary debug elements");
        },
      },
    },
    setElementClass(target, className) {
      if (target) target.className = className;
    },
    setElementDisplay(target, display) {
      if (target) target.style.display = display;
    },
    setElementAttr(target, name, value) {
      if (target) target.setAttribute(name, value);
    },
    setText(id, value) {
      el(id).textContent = String(value);
    },
    setFlipNumber(containerId, valueId, value) {
      el(containerId).dataset.value = String(value);
      el(valueId).textContent = String(value);
    },
    formatNumber(value) {
      return String(value);
    },
    getWeeklyCycleTimePercent() {
      return null;
    },
    getQuotaRiskCandidates() {
      return [];
    },
    pickLowestRemainingRatioCandidate() {
      return null;
    },
    t(key) {
      return key;
    },
    updateRemainingBreath(valueId, wrapperId, status, source) {
      el(valueId).dataset.status = status;
      el(wrapperId).dataset.status = status;
      el(valueId).dataset.source = source;
      el(wrapperId).dataset.source = source;
    },
    renderModelDetails(data) {
      context.lastModelDetails = data;
    },
  };

  vm.createContext(context);
  vm.runInContext(buildAggregateSource(), context);
  return { context, el, api: context.__aggregateProgressTestApi };
}

function makeUsage({ used, total, weeklyUsed, weeklyTotal, lastUpdated }) {
  return {
    ok: true,
    used_count: used,
    remaining_count: total - used,
    total_count: total,
    used_percent: null,
    weekly_used_count: weeklyUsed,
    weekly_remaining_count: weeklyTotal - weeklyUsed,
    weekly_total_count: weeklyTotal,
    weekly_used_percent: null,
    primary_model_name: "MiniMax",
    interval_label: "2h",
    reset_timestamp: 1_768_000_000_000,
    weekly_reset_timestamp: 1_768_604_800_000,
    last_updated: lastUpdated,
  };
}

function initialClassName(id) {
  if (id === "weekly-progress") return "progress-thumb secondary normal";
  if (id === "current-progress") return "progress-thumb normal";
  if (id === "weekly-card") return "cyber-card secondary normal";
  if (id === "current-card") return "cyber-card normal";
  return "";
}

function createBreakdownHarness() {
  const context = {
    state: {
      language: "zh-CN",
      pendingRefreshKeyIds: new Set(),
      perKeyError: {},
      expandedKeyIds: new Set(),
      deleteConfirmKeyId: null,
      usageData: {
        keyA: makeUsage({
          used: 25,
          total: 100,
          weeklyUsed: 75,
          weeklyTotal: 100,
          lastUpdated: "2026-05-16 12:00:00",
        }),
      },
    },
    t(key) {
      return {
        currentInterval: "Current",
        weeklyAggregate: "Weekly",
        copyToClipboard: "Copy",
        syncData: "Refresh",
        editKey: "Edit",
        keyHidden: "Hide",
        restoreKey: "Restore",
        deleteConfirmYes: "Delete",
        expandDetails: "Expand",
        collapseDetails: "Collapse",
        refreshIntervalShort: "refresh",
        unknown: "Unknown",
        retryNow: "Retry",
        deleteConfirm: "Delete this key?",
        deleteConfirmNo: "Cancel",
        modelBreakdown: "Model breakdown",
        modelName: "Model",
        modelUsed: "Used",
        modelRemaining: "Remaining",
        modelTotal: "Total",
        modelWindow: "Window",
        perModelEmpty: "No model detail data.",
        syncedAgo: "{rel} ago",
        secondAgoUnit: "s",
        minuteAgoUnit: "m",
        hourAgoUnit: "h",
        dayAgoUnit: "d",
      }[key] || key;
    },
    formatNumber(value) {
      return String(value);
    },
    formatCountdown() {
      return "1h";
    },
    Date,
  };

  vm.createContext(context);
  vm.runInContext(buildBreakdownSource(), context);
  return { context, api: context.__breakdownProgressTestApi };
}

function buildAggregateSource() {
  const names = [
    "clampPercent",
    "getStatus",
    "getVisibleKeys",
    "getAggregateMetrics",
    "getAggregatePercent",
    "percentFromUsage",
    "formatMetricScale",
    "selectRemainingDisplay",
    "updateProgressBar",
    "renderAggregateView",
  ];
  return `${names.map(name => extractFunction(appJs, name)).join("\n\n")}
globalThis.__aggregateProgressTestApi = {
  getAggregateMetrics,
  getAggregatePercent,
  percentFromUsage,
  selectRemainingDisplay,
  renderAggregateView,
  updateProgressBar,
};`;
}

function buildBreakdownSource() {
  const names = [
    "clampPercent",
    "getStatus",
    "percentFromUsage",
    "formatMetricScale",
    "safeKeyColor",
    "escapeHtml",
    "parseLastUpdatedToEpoch",
    "formatRelative",
    "renderKeyDetailCard",
  ];
  return `${names.map(name => extractFunction(appJs, name)).join("\n\n")}
globalThis.__breakdownProgressTestApi = {
  renderKeyDetailCard,
  formatMetricScale,
};`;
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const paramsOpen = source.indexOf("(", start);
  assert.notEqual(paramsOpen, -1, `Missing function params for ${name}`);

  let paramsDepth = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(") paramsDepth += 1;
    if (char === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsClose = i;
      break;
    }
  }
  assert.notEqual(paramsClose, -1, `Missing function params end for ${name}`);

  const open = source.indexOf("{", paramsClose);
  assert.notEqual(open, -1, `Missing function body for ${name}`);

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(start, i + 1);
    }
  }

  throw new Error(`Unable to extract function ${name}`);
}

function extractCssBlock(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing CSS block ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  assert.notEqual(open, -1, `Missing CSS block open ${selector}`);
  assert.notEqual(close, -1, `Missing CSS block close ${selector}`);
  return source.slice(open + 1, close);
}
