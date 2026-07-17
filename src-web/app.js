// MiniMax Monitor - Tauri Frontend

const transientDialogIds = [
  'api-key-dialog',
  'key-management-modal',
  'key-edit-dialog',
  'update-dialog',
];
const DIALOG_OPEN_ATTR = 'data-minimax-dialog-open';
const RISK_REMAINING_RATIO_THRESHOLD = 0.10;
const CRITICAL_REMAINING_RATIO_THRESHOLD = 0.05;

let uiReady = false;
let modalOpenIntentDepth = 0;
let pendingKeyManagementOpen = false;

function withUserModalIntent(action) {
  console.log('[withUserModalIntent] uiReady:', uiReady, 'visibility:', document.visibilityState, 'hasFocus:', document.hasFocus ? document.hasFocus() : 'N/A');
  if (!uiReady) {
    console.log('[withUserModalIntent] REJECTED: uiReady is false');
    return;
  }
  if (document.visibilityState !== 'visible') {
    console.log('[withUserModalIntent] REJECTED: document not visible');
    return;
  }
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
    console.log('[withUserModalIntent] REJECTED: document not focused');
    return;
  }
  modalOpenIntentDepth += 1;
  try {
    console.log('[withUserModalIntent] executing action');
    return action();
  } finally {
    modalOpenIntentDepth = Math.max(0, modalOpenIntentDepth - 1);
  }
}

function runTrustedModalAction(event, action) {
  console.log('[runTrustedModalAction] isTrusted:', event?.isTrusted, 'uiReady:', uiReady);
  if (!event?.isTrusted) {
    console.log('[runTrustedModalAction] REJECTED: event not trusted');
    return;
  }
  withUserModalIntent(action);
}

function runSystemModalAction(action, retries = 3) {
  const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  console.log('[runSystemModalAction] uiReady:', uiReady, 'visibility:', document.visibilityState, 'hasFocus:', hasFocus, 'retries:', retries);
  if (!uiReady || state?.isBooting) {
    console.log('[runSystemModalAction] REJECTED: uiReady is false');
    if (retries > 0) {
      setTimeout(() => runSystemModalAction(action, retries - 1), 120);
    }
    return;
  }
  if (document.visibilityState !== 'visible') {
    if (retries > 0) {
      setTimeout(() => runSystemModalAction(action, retries - 1), 80);
      return;
    }
    console.log('[runSystemModalAction] REJECTED: document not ready for modal');
    return;
  }
  modalOpenIntentDepth += 1;
  try {
    return action();
  } finally {
    modalOpenIntentDepth = Math.max(0, modalOpenIntentDepth - 1);
  }
}

function canOpenTransientDialog() {
  return uiReady && modalOpenIntentDepth > 0;
}

function setDialogVisibility(dialogId, isOpen) {
  const el = document.getElementById(dialogId);
  if (!el) return;
  if (isOpen) {
    el.setAttribute(DIALOG_OPEN_ATTR, '1');
    el.style.display = 'flex';
  } else {
    el.removeAttribute(DIALOG_OPEN_ATTR);
    el.style.display = 'none';
  }
}

function closeTransientDialogs() {
  transientDialogIds.forEach((id) => setDialogVisibility(id, false));

  const apiKeyInput = document.getElementById('api-key-input');
  if (apiKeyInput) apiKeyInput.blur();

  const keyEditApiKeyInput = document.getElementById('key-edit-api-key');
  if (keyEditApiKeyInput) keyEditApiKeyInput.value = '';
}

window.__MINIMAX_CLOSE_TRANSIENT_DIALOGS__ = closeTransientDialogs;
closeTransientDialogs();

function requestKeyManagementModal() {
  pendingKeyManagementOpen = true;
  runSystemModalAction(() => {
    if (!pendingKeyManagementOpen) return;
    pendingKeyManagementOpen = false;
    showKeyManagementModal();
  }, 12);
}

// Global error handler
window.onerror = function(msg, url, line, col, error) {
    console.error('[GLOBAL ERROR]', msg, 'at line', line, 'col', col);
    return false;
};

let tauriInvoke = null;
let tauriListen = null;
let uiHandlersInitialized = false;
let tauriEventListenersInitialized = false;
let settingsHandlersInitialized = false;

const DEFAULT_CONFIG = Object.freeze({
  config_version: 2,
  refresh_interval_seconds: 20,
  show_weekly_in_status: true,
  show_percent_in_tray: true,
  detail_model_limit: 8,
  current_quota_count: 1500,
  weekly_quota_count: 15000,
  language: 'auto',
  first_run: false,
  start_minimized: false,
  enable_notifications: true,
  api_keys: [],
});

const TAURI_API_READY_TIMEOUT_MS = 3500;
const BOOT_IPC_TIMEOUT_MS = 3000;
const SETTINGS_IPC_TIMEOUT_MS = 3000;
const REFRESH_IPC_TIMEOUT_MS = 18000;
const WRITE_IPC_TIMEOUT_MS = 30000;

function defaultConfig() {
  return { ...DEFAULT_CONFIG, api_keys: [] };
}

function getTauriAPI() {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke || !tauri?.event?.listen) {
    return null;
  }
  return {
    invoke: tauri.core.invoke,
    listen: tauri.event.listen,
  };
}

async function waitForTauriAPI(timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const api = getTauriAPI();
    if (api) return api;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Tauri API not available');
}

function invokeWithTimeout(command, args, timeoutMs = BOOT_IPC_TIMEOUT_MS) {
  if (!tauriInvoke) {
    return Promise.reject(new Error('Tauri API not ready'));
  }

  let timer = null;
  const invokePromise = args === undefined ? tauriInvoke(command) : tauriInvoke(command, args);
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([invokePromise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function invokeOrFallback(command, args, fallback, timeoutMs = BOOT_IPC_TIMEOUT_MS) {
  try {
    return await invokeWithTimeout(command, args, timeoutMs);
  } catch (error) {
    console.warn(`${command} failed:`, error);
    return typeof fallback === 'function' ? fallback(error) : fallback;
  }
}

function runInBackground(label, action) {
  setTimeout(() => {
    Promise.resolve()
      .then(action)
      .catch((error) => console.error(`${label} failed:`, error));
  }, 0);
}

// i18n translations
const i18n = {
  'zh-CN': {
    settings: '设置',
    refreshInterval: '刷新时间（秒）',
    currentQuotaCount: '当前周期额度',
    weeklyQuotaCount: '本周累计额度',
    startMinimized: '启动时最小化到菜单栏',
    autoStart: '开机自动启动',
    enableNotifications: '启用系统通知',
    showPercentInTray: '托盘栏显示使用比例',
    trayIconStyle: '托盘图标风格',
    trayIconStyleDefault: '默认（数字）',
    trayIconStyleMinimal: '简约（圆点）',
    trayIconStyleGauge: '仪表（环形）',
    unconfiguredKey: '未配置加密密钥',
    unconfiguredDesc: '系统核心功能需要 MiniMax API Key 授权。请在控制台中输入您的访问密钥以同步数据。',
    initAccess: '配置密钥',
    waitingData: '等待数据链路',
    waitingDesc: '正在尝试连接 MiniMax 服务器并同步最新的 Token 消耗指标。请保持网络畅通。',
    retrySync: '重试同步',
    dataBroken: '数据链路中断',
    reconnect: '重新连接',
    editKey: '修改密钥',
    panelTitle: 'MINIMAX 用量监控',
    model: '当前模型',
    window: '时间窗口',
    currentInterval: '当前周期',
    consumed: '已使用',
    available: '剩余量',
    limit: '总配额',
    resourceUtil: '资源使用率',
    weeklyAggregate: '本周累计',
    used: '已使用',
    left: '剩余量',
    total: '总额度',
    weeklyQuota: '周使用额度',
    modelDetails: '模型明细',
    topItems: '前',
    itemsSuffix: '项',
    perModelHint: '展开查看各模型额度',
    perModelEmpty: '当前暂无模型明细数据。',
    modelName: '模型',
    modelUsed: '已使用',
    modelRemaining: '剩余',
    modelTotal: '总额度',
    modelWindow: '时间窗口',
    syncedAt: '最后同步: ',
    syncUnavailable: '同步失败，页面保持可用',
    syncData: '刷新数据',
    keyConfig: '配置密钥',
    riskTitle: '风险提示',
    riskRemaining: '当前周期剩余请求次数仅 ',
    riskRemainingWeekly: '本周剩余请求次数仅 ',
    riskExhausted: '额度即将耗尽，建议立即降低请求频率或切换模型！',
    riskFast: '消耗较快，请注意使用配额以避免被限流。',
    languageSwitchLabel: '语言',
    inputBoxTitle: 'MiniMax Monitor',
    inputBoxPrompt: '输入 MiniMax API Key',
    cancel: '取消',
    save: '保存',
    na: '--',
    unknown: '未知',
    keyManagement: 'API Key 管理',
    keyName: '名称',
    keyNameTime: '名称 / 时间',
    keyMask: '密钥掩码',
    keyActions: '编辑 / 删除',
    keyColor: '颜色',
    keyRefresh: '刷新间隔（秒）',
    apiKey: 'API Key',
    noApiKeysConfigured: '暂无 API Key。',
    editAction: '编辑',
    deleteAction: '删除',
    addApiKeyTitle: '新增 API Key',
    editApiKeyTitle: '编辑 API Key',
    deleteKeyTitle: '删除 API Key？',
    deleteKeyMessage: '该操作无法撤销。',
    keyRegion: '区域',
    regionDomestic: '国内 (minimaxi.com)',
    regionOverseas: '海外 (minimax.io)',
    // multi-key view
    allKeys: '全部',
    keysActiveCount: '个密钥',
    addKey: '+ 新增',
    copyToClipboard: '复制',
    copied: '已复制',
    keyHidden: '已隐藏',
    restoreKey: '恢复',
    syncFailed: '同步失败',
    retryNow: '重试',
    expandDetails: '展开',
    collapseDetails: '收起',
    modelBreakdown: '模型明细',
    keyCreated: '创建时间',
    lastSynced: '最近同步',
    syncedAgo: '{rel} 前',
    refreshIntervalShort: '刷新',
    allKeysHidden: '所有密钥已隐藏，点击 👁 恢复。',
    keyboardHint: 'Cmd/Ctrl + 1..9 切换',
    deleteConfirm: '删除该密钥?',
    deleteConfirmYes: '删除',
    deleteConfirmNo: '取消',
    breakdownTitle: '密钥明细',
    aggregateTitle: '全部聚合',
    resetIn: '重置于',
    updateAvailable: '发现新版本',
    updateVersionLabel: '最新版本',
    updateChangelog: '更新日志',
    updateDownloading: '正在下载...',
    updateRestartHint: '下载完成，请重启应用以完成升级',
    updateLater: '稍后',
    updateNow: '立即升级',
    updateDownloadFailed: '下载失败，请稍后重试',
    updateAlreadyLatest: '已是最新版本',
    secondAgoUnit: '秒',
    minuteAgoUnit: '分',
    hourAgoUnit: '时',
    dayAgoUnit: '日',
  },
  en: {
    settings: 'Settings',
    refreshInterval: 'Refresh interval (seconds)',
    currentQuotaCount: 'Current cycle quota',
    weeklyQuotaCount: 'Weekly cumulative quota',
    startMinimized: 'Start minimized to menu bar',
    autoStart: 'Launch at login',
    enableNotifications: 'Enable system notifications',
    showPercentInTray: 'Show usage percent in tray',
    trayIconStyle: 'Tray icon style',
    trayIconStyleDefault: 'Default (Digital)',
    trayIconStyleMinimal: 'Minimal (Dot)',
    trayIconStyleGauge: 'Gauge (Ring)',
    unconfiguredKey: 'Unconfigured API Key',
    unconfiguredDesc: 'System core features require MiniMax API Key authorization. Please enter your access key to sync data.',
    initAccess: 'INITIALIZE ACCESS',
    waitingData: 'Waiting for Data Link',
    waitingDesc: 'Attempting to connect to MiniMax servers and sync the latest Token consumption metrics.',
    retrySync: 'RETRY SYNC',
    dataBroken: 'Data Link Broken',
    reconnect: 'RECONNECT',
    editKey: 'EDIT KEY',
    panelTitle: 'MINIMAX USAGE PANEL',
    model: 'MODEL',
    window: 'WINDOW',
    currentInterval: 'CURRENT INTERVAL',
    consumed: 'CONSUMED',
    available: 'AVAILABLE',
    limit: 'LIMIT',
    resourceUtil: 'RESOURCE UTILIZATION',
    weeklyAggregate: 'WEEKLY AGGREGATE',
    used: 'USED',
    left: 'LEFT',
    total: 'TOTAL',
    weeklyQuota: 'WEEKLY USAGE',
    modelDetails: 'MODEL DETAILS',
    topItems: 'TOP',
    itemsSuffix: 'ITEMS',
    perModelHint: 'Expand to inspect per-model quotas',
    perModelEmpty: 'No model detail data available right now.',
    modelName: 'MODEL',
    modelUsed: 'USED',
    modelRemaining: 'LEFT',
    modelTotal: 'TOTAL',
    modelWindow: 'WINDOW',
    syncedAt: 'SYNCED AT: ',
    syncUnavailable: 'Sync failed, page remains available',
    syncData: 'SYNC DATA',
    keyConfig: 'KEY CONFIG',
    riskTitle: 'Risk Warning',
    riskRemaining: 'Current window remaining requests only ',
    riskRemainingWeekly: 'Weekly remaining requests only ',
    riskExhausted: 'Quota is almost exhausted. Suggest lowering request frequency or switching models!',
    riskFast: 'Consuming quickly. Please monitor usage to avoid rate limits.',
    languageSwitchLabel: 'Language',
    inputBoxTitle: 'MiniMax Monitor',
    inputBoxPrompt: 'Enter MiniMax API Key',
    cancel: 'Cancel',
    save: 'Save',
    na: '--',
    unknown: 'Unknown',
    keyManagement: 'API Key Management',
    keyName: 'Name',
    keyNameTime: 'Name / Time',
    keyMask: 'Key Mask',
    keyActions: 'Edit / Delete',
    keyColor: 'Color',
    keyRefresh: 'Refresh Interval (seconds)',
    apiKey: 'API Key',
    noApiKeysConfigured: 'No API keys configured.',
    editAction: 'Edit',
    deleteAction: 'Delete',
    addApiKeyTitle: 'Add API Key',
    editApiKeyTitle: 'Edit API Key',
    deleteKeyTitle: 'Delete API Key?',
    deleteKeyMessage: 'This action cannot be undone.',
    keyRegion: 'Region',
    regionDomestic: 'Domestic (minimaxi.com)',
    regionOverseas: 'Overseas (minimax.io)',
    // multi-key view
    allKeys: 'ALL',
    keysActiveCount: 'keys',
    addKey: '+ ADD',
    copyToClipboard: 'Copy',
    copied: 'Copied',
    keyHidden: 'Hidden',
    restoreKey: 'Restore',
    syncFailed: 'Sync failed',
    retryNow: 'Retry',
    expandDetails: 'Expand',
    collapseDetails: 'Collapse',
    modelBreakdown: 'MODEL BREAKDOWN',
    keyCreated: 'Created',
    lastSynced: 'synced',
    syncedAgo: '{rel} ago',
    refreshIntervalShort: 'refresh',
    allKeysHidden: 'All keys are hidden. Click 👁 to restore.',
    keyboardHint: 'Cmd/Ctrl + 1..9 to switch',
    deleteConfirm: 'Delete this key?',
    deleteConfirmYes: 'Delete',
    deleteConfirmNo: 'Cancel',
    breakdownTitle: 'PER-KEY BREAKDOWN',
    aggregateTitle: 'AGGREGATE',
    resetIn: 'RESET in',
    updateAvailable: 'New version available',
    updateVersionLabel: 'Latest version',
    updateChangelog: 'Changelog',
    updateDownloading: 'Downloading...',
    updateRestartHint: 'Download complete. Please restart the app to apply the update.',
    updateLater: 'Later',
    updateNow: 'Update now',
    updateDownloadFailed: 'Download failed. Please try again later.',
    updateAlreadyLatest: 'Already on the latest version',
    secondAgoUnit: 's',
    minuteAgoUnit: 'm',
    hourAgoUnit: 'h',
    dayAgoUnit: 'd',
  },
};

// App State
let state = {
  apiKeys: [],
  usageData: {},
  config: null,
  language: 'zh-CN',
  isBooting: true,
  isLoading: false,
  lastError: '',
  // ── multi-key view state ──────────────────────────────
  selectedKeyId: 'ALL',                       // 'ALL' | <key.id>
  expandedKeyIds: new Set(),                  // breakdown 中已展开的 key id
  reorderDraft: null,                         // 拖拽中的临时 id 数组 (string[] | null)
  perKeyError: {},                            // {keyId: errorMessage} 用于 inline 错误
  pendingRefreshKeyIds: new Set(),            // 单 key 刷新时的 loading 状态
  hiddenInRefreshDraft: new Set(),            // 👁 切换的乐观状态
  deleteConfirmKeyId: null,                   // 当前行内删除确认气泡指向的 key
  pendingUpdate: null,                        // { version, notes, pub_date } 当前弹窗中的更新
  updateDownloading: false,                   // 升级下载进行中
  updateDownloadFinished: false,              // 下载完成,等待用户重启
};

// Settings state
let settings = {
  refresh_interval_seconds: 20,
  start_minimized: false,
  autostart: false,
  enable_notifications: true,
  show_percent_in_tray: true,
  tray_icon_style: 'default',
};

let renderScheduled = false;
let usageRenderTimer = null;
const modelTableHtmlCache = new WeakMap();
const USAGE_RENDER_DEBOUNCE_MS = 120;
let modelDetailsSignature = '';

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  const flush = () => {
    renderScheduled = false;
    render();
    bindReorderHandlers();
    syncCountdownTargets();
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 16);
  }
}

function scheduleUsageRender() {
  if (usageRenderTimer) {
    clearTimeout(usageRenderTimer);
  }
  usageRenderTimer = setTimeout(() => {
    usageRenderTimer = null;
    scheduleRender();
  }, USAGE_RENDER_DEBOUNCE_MS);
}

function setElementDisplay(el, display) {
  if (el && el.style.display !== display) {
    el.style.display = display;
  }
}

function setElementClass(el, className) {
  if (el && el.className !== className) {
    el.className = className;
  }
}

function setElementAttr(el, attrName, value) {
  if (!el) return;
  const next = String(value);
  if (el.getAttribute(attrName) !== next) {
    el.setAttribute(attrName, next);
  }
}

function hasUsableUsageData() {
  return Object.values(state.usageData || {}).some(data => data && data.ok);
}

// Initialize app
async function init() {
  uiReady = false;
  closeTransientDialogs();
  state.config = defaultConfig();
  state.language = 'zh-CN';
  state.isBooting = true;
  state.isLoading = true;
  state.lastError = '';
  applyI18n();
  setupUiHandlers();
  applyPlatformAdaptations();
  render();
  startCountdownTimer();
  uiReady = true;

  try {
    const tauri = getTauriAPI();
    if (!tauri) {
      throw new Error('__TAURI__ API not available');
    }
    tauriInvoke = tauri.invoke;
    tauriListen = tauri.listen;

    const [config, fetchedApiKeys, allData] = await Promise.all([
      invokeOrFallback('cmd_get_config', undefined, defaultConfig, BOOT_IPC_TIMEOUT_MS),
      invokeOrFallback('cmd_get_api_keys', undefined, [], BOOT_IPC_TIMEOUT_MS),
      invokeOrFallback('cmd_get_all_usage_data', undefined, {}, BOOT_IPC_TIMEOUT_MS),
    ]);

    state.config = { ...defaultConfig(), ...(config || {}) };
    state.language = state.config?.language === 'auto' ? 'zh-CN' : (state.config?.language || 'zh-CN');
    state.apiKeys = fetchedApiKeys || [];
    state.usageData = allData || {};

    // Apply i18n
    applyI18n();

    // Setup event listeners
    await setupEventListeners();
    closeTransientDialogs();

    // Initial render
    state.isBooting = false;
    state.isLoading = false;
    render();
    closeTransientDialogs();
    if (pendingKeyManagementOpen) {
      requestKeyManagementModal();
    }

    runInBackground('loadSettings', async () => {
      await loadSettings();
      closeTransientDialogs();
      restartAutoRefreshTimer();
    });

    // The native backend starts the initial refresh. Keep the first screen
    // responsive and let the user-triggered retry handle manual refreshes.
  } catch (error) {
    state.isBooting = false;
    state.isLoading = false;
    state.lastError = String(error);
    uiReady = true;
    console.error('Init error:', error);
    showStartupError(error, { recoverable: true });
  }
}

async function setupEventListeners() {
  if (!tauriListen || tauriEventListenersInitialized) return;
  tauriEventListenersInitialized = true;

  // Listen for usage updates from backend (multi-key format: [keyId, UsageData])
  await tauriListen('usage-updated', (event) => {
    const payload = event.payload;
    if (Array.isArray(payload) && payload.length === 2) {
      const [keyId, data] = payload;
      state.usageData[keyId] = data;
      delete state.perKeyError[keyId];
    } else if (payload && typeof payload === 'object' && !payload.keyId) {
      state.usageData['default'] = payload;
    }
    state.lastError = '';
    scheduleUsageRender();
  });

  await tauriListen('usage-error', (event) => {
    console.error('Usage refresh error:', event.payload);
    if (Array.isArray(event.payload) && event.payload.length === 2) {
      const [keyId, msg] = event.payload;
      state.perKeyError[String(keyId)] = String(msg);
      if (!hasUsableUsageData()) {
        state.lastError = String(msg);
      }
    } else {
      if (!hasUsableUsageData()) {
        state.lastError = String(event.payload || '');
      }
    }
    scheduleUsageRender();
  });

  // Listen for show set key dialog event
  await tauriListen('show-set-key-dialog', () => {
    // Disable auto modal popup from background events; user opens it explicitly from UI.
    return;
  });

  // Listen for show key management modal event (from tray menu)
  await tauriListen('show-key-management', () => {
    requestKeyManagementModal();
  });

  // Reset transient UI whenever the native shell is about to reveal the window.
  await tauriListen('app-window-will-show', () => {
    closeTransientDialogs();
    scheduleRender();
  });

  // Listen for window-hidden event - close all dialogs when window is about to hide
  await tauriListen('window-hidden', () => {
    closeTransientDialogs();
  });

  // ── Auto-update events ────────────────────────────────────────────────────
  // 检测到新版本时由后端 emit update-available,前端展示 changelog + [升级]/[稍后]
  await tauriListen('update-available', (event) => {
    const payload = event.payload || {};
    if (!payload.version) return;
    if (state.pendingUpdate && state.pendingUpdate.version === payload.version) return;
    state.pendingUpdate = {
      version: String(payload.version),
      notes: typeof payload.notes === 'string' ? payload.notes : '',
      pub_date: payload.pub_date || null,
    };
    state.updateDownloading = false;
    state.updateDownloadFinished = false;
    showUpdateDialog();
  });

  await tauriListen('update-download-started', () => {
    state.updateDownloading = true;
    state.updateDownloadFinished = false;
    renderUpdateDialog();
  });

  await tauriListen('update-download-progress', (event) => {
    const payload = event.payload || {};
    const chunk = Number(payload.chunk) || 0;
    const total = Number(payload.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((chunk / total) * 100)) : null;
    renderUpdateDialog({ progressPercent: pct });
  });

  await tauriListen('update-download-finished', () => {
    state.updateDownloading = false;
    state.updateDownloadFinished = true;
    renderUpdateDialog();
  });

  await tauriListen('update-download-failed', () => {
    state.updateDownloading = false;
    state.updateDownloadFinished = false;
    alert(t('updateDownloadFailed'));
    hideUpdateDialog();
  });
}

function showStartupError(error, options = {}) {
  const recoverable = options.recoverable !== false;
  const emptyNoKey = document.getElementById('empty-state-no-key');
  const emptyLoading = document.getElementById('empty-state-loading');
  const dashboard = document.getElementById('dashboard');
  const emptyError = document.getElementById('empty-state-error');
  const errorMsg = document.getElementById('error-message');

  [emptyNoKey, emptyLoading].forEach((el) => {
    if (el) el.style.display = 'none';
  });

  if (dashboard) {
    dashboard.style.display = recoverable && state.apiKeys.length > 0 ? 'block' : 'none';
  }

  if (emptyError) emptyError.style.display = 'block';
  if (errorMsg) {
    errorMsg.textContent = recoverable
      ? `启动后台连接失败，页面已进入离线模式: ${String(error)}`
      : `Startup failed: ${String(error)}`;
  }
}

function applyPlatformAdaptations() {
  if (window.__TAURI__ && window.__TAURI__.platform === 'vscode') {
    var tauriOnlyIds = [
      'setting-start-minimized',
      'setting-autostart',
      'setting-notifications',
      'setting-show-percent-in-tray',
      'setting-tray-icon-style',
    ];
    tauriOnlyIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        var item = el.closest('.setting-item');
        if (item) item.style.display = 'none';
      }
    });
  }
}

function setupUiHandlers() {
  if (uiHandlersInitialized) return;
  uiHandlersInitialized = true;
  // Set API Key button - 直接调用，打开对话框
  document.getElementById('btn-set-key')?.addEventListener('click', (e) => {
    console.log('[btn-set-key] clicked');
    runTrustedModalAction(e, showKeyManagementModal);
  });

  // Retry sync button
  document.getElementById('btn-retry-sync')?.addEventListener('click', refreshAllUsage);

  // Reconnect button
  document.getElementById('btn-reconnect')?.addEventListener('click', refreshAllUsage);

  // Edit key button
  document.getElementById('btn-edit-key')?.addEventListener('click', (e) => {
    runTrustedModalAction(e, showKeyManagementModal);
  });

  // Refresh button
  document.getElementById('btn-refresh')?.addEventListener('click', refreshAllUsage);

  // Config key button - 直接调用
  document.getElementById('btn-config-key')?.addEventListener('click', (e) => {
    console.log('[btn-config-key] clicked');
    runTrustedModalAction(e, showKeyManagementModal);
  });

  // Language toggle
  document.getElementById('langToggleBtn')?.addEventListener('click', toggleLanguage);

  // Dialog cancel button
  document.getElementById('btn-cancel-key')?.addEventListener('click', hideApiKeyDialog);

  // Dialog save button
  document.getElementById('btn-save-key')?.addEventListener('click', saveApiKey);

  // Enter key in input
  document.getElementById('api-key-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveApiKey();
  });

  // Close dialog on overlay click
  document.getElementById('api-key-dialog')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('dialog-overlay')) {
      hideApiKeyDialog();
    }
  });

  // Key management modal handlers
  document.getElementById('btn-add-key-modal')?.addEventListener('click', (e) => {
    runTrustedModalAction(e, () => openKeyEditDialog());
  });
  document.getElementById('btn-save-key-edit')?.addEventListener('click', saveKeyEdit);
  document.getElementById('btn-cancel-key-edit')?.addEventListener('click', closeKeyEditDialog);
  document.getElementById('btn-close-modal')?.addEventListener('click', () => {
    setDialogVisibility('key-management-modal', false);
  });
  document.getElementById('btn-close-key-edit')?.addEventListener('click', closeKeyEditDialog);

  // 使用事件委托 - 在 key-management-modal 上绑定事件，处理动态生成的 key-list
  document.getElementById('key-management-modal')?.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const editBtn = e.target.closest('.js-edit-key');
    if (editBtn) {
      const keyId = editBtn.getAttribute('data-key-id');
      withUserModalIntent(() => openKeyEditDialog(keyId));
      return;
    }
    const deleteBtn = e.target.closest('.js-delete-key');
    if (deleteBtn) {
      const keyId = deleteBtn.getAttribute('data-key-id');
      deleteKey(keyId);
    }
  });

  // Key switcher: chip click & + ADD
  document.getElementById('key-switcher')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.key-chip');
    if (!chip) return;
    if (chip.dataset.action === 'add-key') {
      runTrustedModalAction(e, () => openKeyEditDialog());
      return;
    }
    const keyId = chip.getAttribute('data-key-id');
    if (!keyId) return;
    state.selectedKeyId = keyId;
    try { localStorage.setItem('lastSelectedKeyId', keyId); } catch (_) { /* ignore */ }
    scheduleRender();
  });

  // Breakdown card + key header strip action delegation
  const dashboardEl = document.getElementById('dashboard');
  dashboardEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    const action = btn.getAttribute('data-action');
    const keyId = btn.getAttribute('data-key-id');
    if (!keyId) return;
    handleBreakdownAction(action, keyId, e);
  });

  // Click on card body (not on a button) → toggle expand (only in aggregate view)
  document.getElementById('breakdown-list')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-action]')) return;
    const card = e.target.closest('.breakdown-card');
    if (!card) return;
    const keyId = card.getAttribute('data-key-id');
    if (!keyId) return;
    if (state.expandedKeyIds.has(keyId)) state.expandedKeyIds.delete(keyId);
    else state.expandedKeyIds.add(keyId);
    scheduleRender();
  });

  // Cmd/Ctrl + 1..9 → 切换 key
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    const n = Number(e.key);
    if (!Number.isFinite(n) || n < 1 || n > 9) return;
    const visible = state.apiKeys || [];
    if (visible.length === 0) return;
    const order = visible.length > 1 ? ['ALL', ...visible.map(k => k.id)] : visible.map(k => k.id);
    const target = order[n - 1];
    if (target == null) return;
    e.preventDefault();
    state.selectedKeyId = target;
    try { localStorage.setItem('lastSelectedKeyId', target); } catch (_) { /* ignore */ }
    scheduleRender();
  });

  // Update dialog buttons
  document.getElementById('btn-update-later')?.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    hideUpdateDialog();
  });
  document.getElementById('btn-update-now')?.addEventListener('click', async (e) => {
    if (!e.isTrusted) return;
    await startUpdateDownload();
  });
}

async function refreshAllUsage() {
  if (!tauriInvoke || state.apiKeys.length === 0 || state.isLoading) return;

  const hadUsageData = Object.keys(state.usageData).length > 0;
  state.isLoading = true;
  scheduleRender();

  try {
    // Force backend to fetch latest data from API, then return refreshed HashMap.
    const allData = await invokeWithTimeout(
      'cmd_refresh_all_usage_data',
      undefined,
      REFRESH_IPC_TIMEOUT_MS,
    );
    state.usageData = allData || {};
    state.lastError = '';
    scheduleRender();
  } catch (error) {
    console.error('Fetch error:', error);
    if (!hasUsableUsageData()) {
      state.lastError = String(error);
    }
    if (!hadUsageData) {
      state.apiKeys.forEach(key => {
        state.usageData[key.id] = makeErrorUsageData(String(error));
      });
    }
    scheduleRender();
  } finally {
    state.isLoading = false;
    scheduleRender();
  }
}

function makeErrorUsageData(message) {
  return {
    ok: false,
    status_label: message || 'Unknown error',
    primary_model_name: '',
    time_window: '',
    reset_timestamp: null,
    reset_in_label: '',
    total_count: null,
    remaining_count: null,
    used_count: null,
    used_percent: null,
    remaining_percent: null,
    weekly_total_count: null,
    weekly_used_count: null,
    weekly_remaining_count: null,
    weekly_used_percent: null,
    weekly_remaining_percent: null,
    weekly_reset_timestamp: null,
    weekly_reset_in_label: '',
    interval_label: '',
    models: [],
    last_updated: new Date().toLocaleString(),
  };
}

async function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const apiKey = input?.value?.trim();

  if (!apiKey) {
    return;
  }

  try {
    // Use cmd_add_api_key for multi-key support
    await invokeWithTimeout('cmd_add_api_key', {
      name: 'Key ' + (state.apiKeys.length + 1),
      color: '#00d4ff',
      apiKey: apiKey,
      refreshInterval: settings.refresh_interval_seconds || 20,
      currentQuotaCount: DEFAULT_CONFIG.current_quota_count,
      weeklyQuotaCount: DEFAULT_CONFIG.weekly_quota_count,
    }, WRITE_IPC_TIMEOUT_MS);
    hideApiKeyDialog();
    await loadApiKeys();
    runInBackground('refresh after saving API key', refreshAllUsage);
  } catch (error) {
    console.error('Save API key error:', error);
    alert(state.language === 'zh-CN' ? '保存失败: ' + error : 'Failed to save: ' + error);
  }
}

function showApiKeyDialog() {
  console.log('[showApiKeyDialog] uiReady:', uiReady, 'modalOpenIntentDepth:', modalOpenIntentDepth);
  console.log('[showApiKeyDialog] visibility:', document.visibilityState, 'hasFocus:', document.hasFocus());
  if (!canOpenTransientDialog()) return;
  // Guard: if init() hasn't completed yet, do nothing
  // (state.config is null before init finishes loading config and keys)
  if (state.config === null) {
    return;
  }
  // If API keys already exist, open the management modal instead
  if (state.apiKeys.length > 0) {
    showKeyManagementModal();
    return;
  }
  const dialog = document.getElementById('api-key-dialog');
  const input = document.getElementById('api-key-input');
  if (dialog) {
    setDialogVisibility('api-key-dialog', true);
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function hideApiKeyDialog() {
  setDialogVisibility('api-key-dialog', false);
}

async function toggleLanguage() {
  if (!tauriInvoke) return;

  state.language = state.language === 'zh-CN' ? 'en' : 'zh-CN';

  // Save preference
  try {
    const newConfig = { ...state.config, language: state.language };
    await invokeWithTimeout('cmd_save_config', { config: newConfig }, WRITE_IPC_TIMEOUT_MS);
    state.config = newConfig;
  } catch (error) {
    console.error('Save language error:', error);
  }

  applyI18n();
  scheduleRender();
}

async function loadSettings() {
  if (!tauriInvoke) return;

  try {
    const config = await invokeWithTimeout('cmd_get_config', undefined, SETTINGS_IPC_TIMEOUT_MS);
    settings.refresh_interval_seconds = normalizeRefreshIntervalSeconds(config.refresh_interval_seconds);
    settings.start_minimized = config.start_minimized || false;
    settings.enable_notifications = config.enable_notifications !== false;
    settings.show_percent_in_tray = config.show_percent_in_tray !== false;
    settings.tray_icon_style = config.tray_icon_style || 'default';

    // Load autostart status
    settings.autostart = await invokeOrFallback(
      'cmd_get_autostart',
      undefined,
      false,
      SETTINGS_IPC_TIMEOUT_MS,
    );

    // Update UI
    const startMinimizedEl = document.getElementById('setting-start-minimized');
    const autostartEl = document.getElementById('setting-autostart');
    const notificationsEl = document.getElementById('setting-notifications');
    const showPercentInTrayEl = document.getElementById('setting-show-percent-in-tray');
    const refreshIntervalEl = document.getElementById('setting-refresh-interval');

    if (refreshIntervalEl) refreshIntervalEl.value = String(settings.refresh_interval_seconds);
    if (startMinimizedEl) startMinimizedEl.checked = settings.start_minimized;
    if (autostartEl) autostartEl.checked = settings.autostart;
    if (notificationsEl) notificationsEl.checked = settings.enable_notifications;
    if (showPercentInTrayEl) showPercentInTrayEl.checked = settings.show_percent_in_tray;

    attachSettingsHandlers();

    // Tray icon style
    const trayIconStyleEl = document.getElementById('setting-tray-icon-style');
    if (trayIconStyleEl) {
      trayIconStyleEl.value = settings.tray_icon_style;
      trayIconStyleEl.addEventListener('change', (e) => {
        saveSetting('tray_icon_style', e.target.value);
      });
    }
  } catch (error) {
    console.error('Load settings error:', error);
  }
}

function attachSettingsHandlers() {
  if (settingsHandlersInitialized) return;
  settingsHandlersInitialized = true;

  const startMinimizedEl = document.getElementById('setting-start-minimized');
  const autostartEl = document.getElementById('setting-autostart');
  const notificationsEl = document.getElementById('setting-notifications');
  const showPercentInTrayEl = document.getElementById('setting-show-percent-in-tray');
  const refreshIntervalEl = document.getElementById('setting-refresh-interval');

  startMinimizedEl?.addEventListener('change', (e) => {
    saveSetting('start_minimized', e.target.checked);
  });

  autostartEl?.addEventListener('change', (e) => {
    saveAutostart(e.target.checked);
  });

  notificationsEl?.addEventListener('change', (e) => {
    saveSetting('enable_notifications', e.target.checked);
  });

  showPercentInTrayEl?.addEventListener('change', (e) => {
    saveSetting('show_percent_in_tray', e.target.checked);
  });

  refreshIntervalEl?.addEventListener('change', async (e) => {
    const normalized = normalizeRefreshIntervalSeconds(e.target.value);
    e.target.value = String(normalized);
    await saveSetting('refresh_interval_seconds', normalized);
    restartAutoRefreshTimer();
  });
}

async function saveSetting(key, value) {
  if (!tauriInvoke) return;

  try {
    const config = await invokeWithTimeout('cmd_get_config', undefined, SETTINGS_IPC_TIMEOUT_MS);
    config[key] = value;
    await invokeWithTimeout('cmd_save_config', { config }, WRITE_IPC_TIMEOUT_MS);
    settings[key] = value;
    state.config = { ...state.config, ...config };
    scheduleRender();
  } catch (error) {
    console.error('Save setting error:', error);
  }
}

function normalizeRefreshIntervalSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(3600, Math.max(5, Math.round(parsed)));
}

function normalizeQuotaCount(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100000000, Math.max(1, Math.round(parsed)));
}

async function saveAutostart(enabled) {
  if (!tauriInvoke) return;

  try {
    await invokeWithTimeout('cmd_set_autostart', { enabled }, WRITE_IPC_TIMEOUT_MS);
    settings.autostart = enabled;
  } catch (error) {
    console.error('Save autostart error:', error);
    // Revert UI state
    const autostartEl = document.getElementById('setting-autostart');
    if (autostartEl) autostartEl.checked = !enabled;
  }
}

function t(key) {
  return i18n[state.language]?.[key] || i18n['zh-CN'][key] || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  // Update active language indicator
  const langZh = document.getElementById('lang-zh');
  const langEn = document.getElementById('lang-en');
  if (langZh) langZh.classList.toggle('active', state.language === 'zh-CN');
  if (langEn) langEn.classList.toggle('active', state.language === 'en');

  // Update document lang
  document.documentElement.lang = state.language === 'zh-CN' ? 'zh-CN' : 'en';
}

function render() {
  const emptyNoKey = document.getElementById('empty-state-no-key');
  const emptyLoading = document.getElementById('empty-state-loading');
  const emptyError = document.getElementById('empty-state-error');
  const dashboard = document.getElementById('dashboard');
  // Hide all states
  setElementDisplay(emptyNoKey, 'none');
  setElementDisplay(emptyLoading, 'none');
  setElementDisplay(emptyError, 'none');
  setElementDisplay(dashboard, 'none');
  setDialogVisibility('api-key-dialog', false);

  if (state.isBooting) {
    setElementDisplay(emptyLoading, 'block');
    return;
  }

  renderKeySwitcher();
  if (state.apiKeys.length === 0) {
    setElementDisplay(emptyNoKey, 'block');
    return;
  }

  // Render dashboard
  setElementDisplay(dashboard, 'block');
  renderDashboard();
}

function renderKeySwitcher() {
  const switcher = document.getElementById('key-switcher');
  if (!switcher) return;

  const visible = state.apiKeys || [];
  // 不展示切换器：0 个 key 或只有 1 个 key 时
  if (visible.length === 0) {
    setElementDisplay(switcher, 'none');
    switcher.innerHTML = '';
    return;
  }

  setElementDisplay(switcher, 'flex');

  const order = state.reorderDraft && state.reorderDraft.length === visible.length
    ? state.reorderDraft.map(id => visible.find(k => k.id === id)).filter(Boolean)
    : visible;

  const chips = [];

  // ALL chip — only when >1 keys
  if (visible.length > 1) {
    const agg = getAggregatePercent();
    const palette = order.filter(k => k.is_active !== false).map(k => safeKeyColor(k.color));
    let gradient;
    if (palette.length === 0) {
      gradient = 'var(--primary)';
    } else if (palette.length === 1) {
      gradient = palette[0];
    } else {
      const step = 360 / palette.length;
      gradient = palette
        .map((c, i) => `${c} ${Math.round(i * step)}deg ${Math.round((i + 1) * step)}deg`)
        .join(', ');
    }
    const allSelected = state.selectedKeyId === 'ALL' ? 'selected' : '';
    const allActiveKeys = order.filter(k => k.is_active !== false).length;
    chips.push(`
      <button type="button"
              class="key-chip ${allSelected}"
              data-key-id="ALL"
              role="tab"
              aria-selected="${state.selectedKeyId === 'ALL'}"
              style="--key-color: var(--primary); --key-glow: rgba(0,212,255,0.35); --multi-gradient: ${gradient};">
        <span class="key-chip-multi-dot"></span>
        <span class="key-chip-name">${t('allKeys')}</span>
        <span class="key-chip-pct">${allActiveKeys} ${t('keysActiveCount')} · ${Math.round(agg)}%</span>
      </button>
    `);
  }

  order.forEach(key => {
    const color = safeKeyColor(key.color);
    const glow = hexToRgba(color, 0.35);
    const data = state.usageData[key.id];
    const pct = Math.round(percentFromUsage(data, 'used_count', 'total_count', 'used_percent'));
    const status = data && data.ok ? getStatus(pct) : 'normal';
    const selected = state.selectedKeyId === key.id ? 'selected' : '';
    const hiddenCls = key.is_active === false ? 'hidden-key' : '';
    const riskCls = status === 'critical' || status === 'warning' ? 'risk' : '';
    chips.push(`
      <button type="button"
              class="key-chip ${selected} ${hiddenCls} ${riskCls}"
              data-key-id="${escapeHtml(key.id)}"
              draggable="true"
              role="tab"
              aria-selected="${state.selectedKeyId === key.id}"
              style="--key-color: ${color}; --key-glow: ${glow};">
        <span class="key-chip-dot"></span>
        <span class="key-chip-name">${escapeHtml(key.name || t('unknown'))}</span>
        <span class="key-chip-pct">${pct}%</span>
      </button>
    `);
  });

  chips.push(`
    <button type="button"
            id="key-chip-add"
            class="key-chip key-chip-add"
            data-action="add-key">
      <span data-i18n="addKey">${t('addKey')}</span>
    </button>
  `);

  switcher.innerHTML = chips.join('');
}

function renderDashboard() {
  const dashboard = document.getElementById('dashboard');
  const view = state.selectedKeyId === 'ALL' || !getKeyById(state.selectedKeyId)
    ? 'aggregate'
    : 'single';

  // toggle root class so CSS can target single-key view
  if (dashboard) {
    dashboard.classList.toggle('single-key', view === 'single');
    dashboard.classList.toggle('aggregate', view === 'aggregate');
  }

  const headerStrip = document.getElementById('key-header-strip');
  const breakdown = document.getElementById('per-key-breakdown');

  if (view === 'aggregate') {
    setElementDisplay(headerStrip, 'none');
    setElementDisplay(breakdown, 'block');
    renderAggregateView();
    renderBreakdownList();
  } else {
    setElementDisplay(headerStrip, 'flex');
    setElementDisplay(breakdown, 'none');
    renderSingleKeyView(state.selectedKeyId);
  }
}

function renderAggregateView() {
  setElementDisplay(document.getElementById('model-details-card'), 'none');
  document.documentElement.style.removeProperty('--key-color');
  document.documentElement.style.removeProperty('--key-glow');
  const m = getAggregateMetrics();
  const visibleKeys = getVisibleKeys();

  setText('primary-model', m.primaryModel || t('unknown'));
  const statusLabel = state.lastError && !m.hasData
    ? t('syncUnavailable')
    : (state.isLoading && !m.hasData ? t('waitingData') : t('na'));
  setText('interval-label', m.intervalLabel || statusLabel);

  // CURRENT aggregate
  const currentPercent = m.total > 0 ? clampPercent((m.used / m.total) * 100) : (m.usedPercent ?? 0);
  const currentStatus = getStatus(currentPercent);
  setText('current-used', formatNumber(m.used));
  setFlipNumber('current-remaining-container', 'current-remaining', formatNumber(m.remaining));
  setText('current-total', formatNumber(m.total));
  setText('current-percent', `${Math.round(currentPercent)}%`);
  setElementClass(document.getElementById('current-percent'), `progress-percent ${currentStatus}`);
  updateProgressBar('current-card', 'current-progress', currentPercent, currentStatus);
  updateRemainingBreath('current-remaining', 'current-remaining-wrapper', currentStatus);

  if (m.earliestReset > 0) {
    setElementAttr(document.getElementById('window-countdown'), 'data-timestamp', m.earliestReset);
  }

  // WEEKLY aggregate
  const weeklyPercent = m.weeklyTotal > 0
    ? clampPercent((m.weeklyUsed / m.weeklyTotal) * 100)
    : (m.weeklyUsedPercent ?? 0);
  const weeklyStatus = getStatus(weeklyPercent);
  setText('weekly-used', formatNumber(m.weeklyUsed));
  setFlipNumber('weekly-remaining-container', 'weekly-remaining', formatNumber(m.weeklyRemaining));
  setText('weekly-total', formatNumber(m.weeklyTotal));
  setText('weekly-percent', `${Math.round(weeklyPercent)}%`);
  setElementClass(document.getElementById('weekly-percent'), `progress-percent ${weeklyStatus}`);
  updateProgressBar('weekly-card', 'weekly-progress', weeklyPercent, weeklyStatus, {
    timePercent: getWeeklyCycleTimePercent(m.earliestWeeklyReset),
  });
  updateRemainingBreath('weekly-remaining', 'weekly-remaining-wrapper', weeklyStatus);

  if (m.earliestWeeklyReset > 0) {
    setElementAttr(document.getElementById('weekly-countdown'), 'data-timestamp', m.earliestWeeklyReset);
  }

  // Risk alert (aggregate: lowest remaining quota ratio among visible keys)
  const riskCard = document.getElementById('risk-alert-card');
  const candidates = [];
  visibleKeys.forEach(key => {
    const data = state.usageData[key.id];
    if (!data || !data.ok) return;
    candidates.push(...getQuotaRiskCandidates(data));
  });
  const minEntry = candidates.length > 0
    ? pickLowestRemainingRatioCandidate(candidates)
    : null;

  if (minEntry && minEntry.remainingRatio < RISK_REMAINING_RATIO_THRESHOLD && riskCard) {
    const isCritical = minEntry.remainingRatio <= CRITICAL_REMAINING_RATIO_THRESHOLD;
    const labelKey = minEntry.kind === 'weekly' ? 'riskRemainingWeekly' : 'riskRemaining';
    setText('risk-window-label', t(labelKey));
    setText('risk-remaining-percent', formatRemainingQuota(minEntry));
    setText('risk-message', t(isCritical ? 'riskExhausted' : 'riskFast'));
    setElementClass(document.getElementById('risk-icon'), 'risk-icon');
    document.getElementById('risk-icon').textContent = isCritical ? '🚨' : '⚠️';
    setElementClass(riskCard, `cyber-card risk-alert ${isCritical ? 'critical' : 'warning'}`);
    setElementDisplay(riskCard, 'flex');
  } else if (riskCard) {
    setElementDisplay(riskCard, 'none');
  }

  // Model details: pick first key with data
  const firstWithData = visibleKeys.find(k => state.usageData[k.id] && state.usageData[k.id].ok);
  renderModelDetails(firstWithData ? state.usageData[firstWithData.id] : null);

  // last-updated: latest among visible keys
  const latest = visibleKeys.reduce((acc, k) => {
    const data = state.usageData[k.id];
    if (data && data.last_updated && (!acc || data.last_updated > acc)) return data.last_updated;
    return acc;
  }, '');
  setText('last-updated', latest || '--');

  // All-hidden hint
  const hint = document.getElementById('all-hidden-hint');
  const allHidden = state.apiKeys.length > 0 && visibleKeys.length === 0;
  if (hint) setElementDisplay(hint, allHidden ? 'block' : 'none');
}

function renderBreakdownList() {
  const container = document.getElementById('breakdown-list');

  if (!container) return;

  const order = state.reorderDraft && state.reorderDraft.length === state.apiKeys.length
    ? state.reorderDraft.map(id => state.apiKeys.find(k => k.id === id)).filter(Boolean)
    : state.apiKeys;

  if (!order.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = order.map(key => renderKeyDetailCard(key)).join('');
}

function renderKeyDetailCard(key) {
  const color = safeKeyColor(key.color);
  const data = state.usageData[key.id];
  const currentPct = percentFromUsage(data, 'used_count', 'total_count', 'used_percent');
  const weeklyPct = percentFromUsage(data, 'weekly_used_count', 'weekly_total_count', 'weekly_used_percent');
  const isHidden = key.is_active === false;
  const isLoading = state.pendingRefreshKeyIds.has(key.id);
  const inlineError = state.perKeyError[key.id];
  const expanded = state.expandedKeyIds.has(key.id);
  const confirmingDelete = state.deleteConfirmKeyId === key.id;

  const currentStatus = data && data.ok ? getStatus(currentPct) : 'normal';
  const weeklyStatus = data && data.ok ? getStatus(weeklyPct) : 'normal';

  const refreshSec = Math.max(1, Number(key.refresh_interval) || 20);
  const subtitle = data && data.ok
    ? `${escapeHtml(data.primary_model_name || t('unknown'))} · ${refreshSec}s · ${escapeHtml(formatRelative(parseLastUpdatedToEpoch(data.last_updated)))}`
    : `${refreshSec}s ${t('refreshIntervalShort')}`;

  const errorBlock = inlineError
    ? `<div class="breakdown-inline-error">⚠ ${escapeHtml(inlineError)} <button data-action="retry" data-key-id="${escapeHtml(key.id)}">${t('retryNow')}</button></div>`
    : '';

  const confirmBubble = confirmingDelete
    ? `<div class="breakdown-confirm-bubble">
         <span>${t('deleteConfirm')}</span>
         <button class="breakdown-action-btn danger" data-action="confirm-delete" data-key-id="${escapeHtml(key.id)}">${t('deleteConfirmYes')}</button>
         <button class="breakdown-action-btn" data-action="cancel-delete" data-key-id="${escapeHtml(key.id)}">${t('deleteConfirmNo')}</button>
       </div>`
    : '';

  const actions = isHidden
    ? `<button class="breakdown-action-btn" data-action="toggle-hidden" data-key-id="${escapeHtml(key.id)}" title="${t('restoreKey')}">👁</button>`
    : `
      <button class="breakdown-action-btn" data-action="copy-mask" data-key-id="${escapeHtml(key.id)}" title="${t('copyToClipboard')}">📋</button>
      <button class="breakdown-action-btn" data-action="refresh" data-key-id="${escapeHtml(key.id)}" title="${t('syncData')}">⟳</button>
      <button class="breakdown-action-btn" data-action="edit" data-key-id="${escapeHtml(key.id)}" title="${t('editKey')}">✎</button>
      <button class="breakdown-action-btn" data-action="toggle-hidden" data-key-id="${escapeHtml(key.id)}" title="${t('keyHidden')}">👁</button>
      <button class="breakdown-action-btn danger" data-action="delete" data-key-id="${escapeHtml(key.id)}" title="${t('deleteConfirmYes')}">✕</button>
      <button class="breakdown-action-btn" data-action="toggle-expand" data-key-id="${escapeHtml(key.id)}" title="${t(expanded ? 'collapseDetails' : 'expandDetails')}">${expanded ? '▴' : '▾'}</button>
    `;

  const metricRow = (label, pct, status, used, total, reset, kindSuffix) => {
    return `
    <div class="breakdown-metric-row ${status} ${isLoading ? 'breakdown-shimmer' : ''}" style="--metric-scale: ${formatMetricScale(pct)};">
      <span class="metric-label">${label}</span>
      <div class="metric-bar"><div class="metric-bar-fill"></div></div>
      <span class="metric-pct">${data && data.ok ? Math.round(pct) + '%' : '—'}</span>
      <span class="metric-numbers">${data && data.ok ? `${formatNumber(used)} / ${formatNumber(total)}` : '—'}</span>
      <span class="metric-reset" data-timestamp="${reset || 0}" data-reset-kind="${kindSuffix}">${reset > 0 ? formatCountdown(reset) : '&nbsp;'}</span>
    </div>
  `;
  };

  const modelRows = expanded && data && data.ok && Array.isArray(data.models)
    ? data.models.map(model => `
        <tr>
          <td class="model-cell">${escapeHtml(model.name)}</td>
          <td class="metric-cell used">${formatNumber(model.used_count)}</td>
          <td class="metric-cell remaining">${formatNumber(model.remaining_count)}</td>
          <td class="metric-cell total">${formatNumber(model.total_count)}</td>
          <td class="window-cell">${escapeHtml(model.time_window || '--')}</td>
        </tr>
      `).join('')
    : '';

  const expandBlock = expanded
    ? `<div class="breakdown-expand">
         <div class="model-details-summary-left" style="margin-bottom: 6px;">
           <span class="model-details-icon">🧩</span>
           <span class="model-details-title">${t('modelBreakdown')}</span>
         </div>
         <table class="model-details-table">
           <thead>
             <tr>
               <th>${t('modelName')}</th>
               <th>${t('modelUsed')}</th>
               <th>${t('modelRemaining')}</th>
               <th>${t('modelTotal')}</th>
               <th>${t('modelWindow')}</th>
             </tr>
           </thead>
           <tbody>${modelRows || `<tr><td colspan="5" class="model-details-empty">${t('perModelEmpty')}</td></tr>`}</tbody>
         </table>
       </div>`
    : '';

  const cardCls = [
    'breakdown-card',
    isHidden ? 'disabled' : '',
    inlineError ? 'error' : '',
    expanded ? 'expanded' : '',
  ].join(' ').trim();

  return `
    <article class="${cardCls}"
             data-key-id="${escapeHtml(key.id)}"
             draggable="${isHidden ? 'false' : 'true'}"
             style="--key-color: ${color};">
      <div class="breakdown-card-body">
        <div class="breakdown-meta-row">
          <span class="key-chip-dot" style="background: ${color};"></span>
          <span class="name">${escapeHtml(key.name || t('unknown'))}</span>
          <span class="mask">${escapeHtml(key.masked_key || '--')}</span>
          <span class="subtitle">${subtitle}</span>
          <span class="breakdown-actions">${actions}</span>
        </div>
        ${errorBlock}
        ${metricRow(t('currentInterval'), currentPct, currentStatus, data?.used_count, data?.total_count, data?.reset_timestamp, 'current')}
        ${metricRow(t('weeklyQuota'), weeklyPct, weeklyStatus, data?.weekly_used_count, data?.weekly_total_count, data?.weekly_reset_timestamp, 'weekly')}
        ${expandBlock}
      </div>
      ${confirmBubble}
    </article>
  `;
}

function renderSingleKeyView(keyId) {
  setElementDisplay(document.getElementById('model-details-card'), 'block');
  const key = getKeyById(keyId);
  if (!key) {
    state.selectedKeyId = 'ALL';
    try { localStorage.setItem('lastSelectedKeyId', 'ALL'); } catch (_) { /* ignore */ }
    scheduleRender();
    return;
  }

  const color = safeKeyColor(key.color);
  const glow = hexToRgba(color, 0.35);
  document.documentElement.style.setProperty('--key-color', color);
  document.documentElement.style.setProperty('--key-glow', glow);

  const stripDot = document.getElementById('strip-dot');
  if (stripDot) stripDot.style.background = color;
  setText('strip-name', key.name || t('unknown'));
  setText('strip-mask', key.masked_key || '--');
  const data = state.usageData[key.id];
  const refreshSec = Math.max(1, Number(key.refresh_interval) || 20);
  const sub = data && data.ok
    ? `${data.primary_model_name || t('unknown')} · ${refreshSec}s · ${formatRelative(parseLastUpdatedToEpoch(data.last_updated))}`
    : `${refreshSec}s ${t('refreshIntervalShort')}`;
  setText('strip-sub', sub);

  const stripActions = document.getElementById('strip-actions');
  if (stripActions) {
    stripActions.innerHTML = `
      <button class="breakdown-action-btn" data-action="refresh" data-key-id="${escapeHtml(key.id)}" title="${t('syncData')}">⟳</button>
      <button class="breakdown-action-btn" data-action="edit" data-key-id="${escapeHtml(key.id)}" title="${t('editKey')}">✎</button>
      <button class="breakdown-action-btn danger" data-action="delete" data-key-id="${escapeHtml(key.id)}" title="${t('deleteConfirmYes')}">✕</button>
    `;
  }

  const inlineError = state.perKeyError[key.id];

  setText('primary-model', data && data.ok ? (data.primary_model_name || t('unknown')) : t('unknown'));
  setText('interval-label', data && data.ok ? (data.interval_label || t('na')) : (inlineError ? t('syncFailed') : t('waitingData')));

  const currentPercent = percentFromUsage(data, 'used_count', 'total_count', 'used_percent');
  const currentStatus = data && data.ok ? getStatus(currentPercent) : 'normal';

  setText('current-used', data && data.ok ? formatNumber(data.used_count) : '—');
  setFlipNumber('current-remaining-container', 'current-remaining', data && data.ok ? formatNumber(data.remaining_count) : '—');
  setText('current-total', data && data.ok ? formatNumber(data.total_count) : '—');
  setText('current-percent', data && data.ok ? `${Math.round(currentPercent)}%` : '--%');
  setElementClass(document.getElementById('current-percent'), `progress-percent ${currentStatus}`);
  updateProgressBar('current-card', 'current-progress', currentPercent, currentStatus);
  updateRemainingBreath('current-remaining', 'current-remaining-wrapper', currentStatus);
  if (data && data.reset_timestamp) {
    setElementAttr(document.getElementById('window-countdown'), 'data-timestamp', data.reset_timestamp);
  }

  const weeklyPercent = percentFromUsage(data, 'weekly_used_count', 'weekly_total_count', 'weekly_used_percent');
  const weeklyStatus = data && data.ok ? getStatus(weeklyPercent) : 'normal';

  setText('weekly-used', data && data.ok ? formatNumber(data.weekly_used_count) : '—');
  setFlipNumber('weekly-remaining-container', 'weekly-remaining', data && data.ok ? formatNumber(data.weekly_remaining_count) : '—');
  setText('weekly-total', data && data.ok ? formatNumber(data.weekly_total_count) : '—');
  setText('weekly-percent', data && data.ok ? `${Math.round(weeklyPercent)}%` : '--%');
  setElementClass(document.getElementById('weekly-percent'), `progress-percent ${weeklyStatus}`);
  updateProgressBar('weekly-card', 'weekly-progress', weeklyPercent, weeklyStatus, {
    timePercent: getWeeklyCycleTimePercent(data?.weekly_reset_timestamp),
  });
  updateRemainingBreath('weekly-remaining', 'weekly-remaining-wrapper', weeklyStatus);
  if (data && data.weekly_reset_timestamp) {
    setElementAttr(document.getElementById('weekly-countdown'), 'data-timestamp', data.weekly_reset_timestamp);
  }

  const riskCard = document.getElementById('risk-alert-card');
  const riskEntry = data && data.ok ? pickLowestRemainingRatioCandidate(getQuotaRiskCandidates(data)) : null;
  if (riskEntry && riskEntry.remainingRatio < RISK_REMAINING_RATIO_THRESHOLD && riskCard) {
    const isCritical = riskEntry.remainingRatio <= CRITICAL_REMAINING_RATIO_THRESHOLD;
    const labelKey = riskEntry.kind === 'weekly' ? 'riskRemainingWeekly' : 'riskRemaining';
    setText('risk-window-label', t(labelKey));
    setText('risk-remaining-percent', formatRemainingQuota(riskEntry));
    setText('risk-message', t(isCritical ? 'riskExhausted' : 'riskFast'));
    document.getElementById('risk-icon').textContent = isCritical ? '🚨' : '⚠️';
    setElementClass(riskCard, `cyber-card risk-alert ${isCritical ? 'critical' : 'warning'}`);
    setElementDisplay(riskCard, 'flex');
  } else if (riskCard) {
    setElementDisplay(riskCard, 'none');
  }

  renderModelDetails(data && data.ok ? data : null);

  setText('last-updated', data && data.last_updated ? data.last_updated : '--');
}

// ── breakdown action handlers ──────────────────────────────────────────────

function showCopyToast(message) {
  const toast = document.getElementById('copy-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 1400);
}

async function handleBreakdownAction(action, keyId, evt) {
  if (!action || !keyId) return;
  const key = getKeyById(keyId);

  switch (action) {
    case 'copy-mask': {
      if (!key) return;
      const text = key.masked_key || '';
      try {
        await navigator.clipboard.writeText(text);
        showCopyToast(t('copied'));
      } catch (e) {
        console.warn('clipboard fail', e);
      }
      return;
    }
    case 'refresh': {
      state.pendingRefreshKeyIds.add(keyId);
      scheduleRender();
      try {
        await refreshAllUsage();
      } finally {
        state.pendingRefreshKeyIds.delete(keyId);
        scheduleRender();
      }
      return;
    }
    case 'edit': {
      runTrustedModalAction(evt, () => openKeyEditDialog(keyId));
      return;
    }
    case 'toggle-hidden': {
      if (!key) return;
      const idx = state.apiKeys.findIndex(k => k.id === keyId);
      if (idx < 0) return;
      const nextActive = state.apiKeys[idx].is_active === false;
      state.apiKeys[idx] = { ...state.apiKeys[idx], is_active: nextActive };
      scheduleRender();
      return;
    }
    case 'delete': {
      state.deleteConfirmKeyId = keyId;
      scheduleRender();
      return;
    }
    case 'cancel-delete': {
      state.deleteConfirmKeyId = null;
      scheduleRender();
      return;
    }
    case 'confirm-delete': {
      state.deleteConfirmKeyId = null;
      try {
        await invokeWithTimeout('cmd_delete_api_key', { id: keyId }, WRITE_IPC_TIMEOUT_MS);
        if (state.selectedKeyId === keyId) state.selectedKeyId = 'ALL';
        await loadApiKeys();
        delete state.usageData[keyId];
        delete state.perKeyError[keyId];
        scheduleRender();
      } catch (e) {
        console.error('delete failed', e);
      }
      return;
    }
    case 'toggle-expand': {
      if (state.expandedKeyIds.has(keyId)) state.expandedKeyIds.delete(keyId);
      else state.expandedKeyIds.add(keyId);
      scheduleRender();
      return;
    }
    case 'retry': {
      delete state.perKeyError[keyId];
      state.pendingRefreshKeyIds.add(keyId);
      scheduleRender();
      try {
        await refreshAllUsage();
      } finally {
        state.pendingRefreshKeyIds.delete(keyId);
        scheduleRender();
      }
      return;
    }
    default:
      return;
  }
}

// ── drag-and-drop reorder ──────────────────────────────────────────────────

const dragState = {
  active: false,
  source: null,           // dragged element
  sourceKeyId: null,
  sourceContainer: null,  // 'switcher' | 'breakdown'
};

function bindReorderHandlers() {
  const switcher = document.getElementById('key-switcher');
  const breakdown = document.getElementById('breakdown-list');

  const onDragStart = (origin) => (e) => {
    const el = e.target.closest(origin === 'switcher' ? '.key-chip[draggable="true"]' : '.breakdown-card[draggable="true"]');
    if (!el) return;
    const keyId = el.getAttribute('data-key-id');
    if (!keyId || keyId === 'ALL') return;
    dragState.active = true;
    dragState.source = el;
    dragState.sourceKeyId = keyId;
    dragState.sourceContainer = origin;
    el.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', keyId); e.dataTransfer.effectAllowed = 'move'; } catch (_) { /* ignore */ }
  };

  const onDragOver = (origin) => (e) => {
    if (!dragState.active) return;
    e.preventDefault();
    const targetEl = e.target.closest(origin === 'switcher' ? '.key-chip[draggable="true"]' : '.breakdown-card[draggable="true"]');
    if (!targetEl || targetEl === dragState.source) return;
    const containerEl = origin === 'switcher' ? switcher : breakdown;
    const rect = targetEl.getBoundingClientRect();
    const after = origin === 'switcher'
      ? (e.clientX - rect.left) > rect.width / 2
      : (e.clientY - rect.top) > rect.height / 2;
    if (after) targetEl.after(dragState.source);
    else containerEl.insertBefore(dragState.source, targetEl);
  };

  const onDrop = (origin) => async (e) => {
    if (!dragState.active) return;
    e.preventDefault();
    const containerEl = origin === 'switcher' ? switcher : breakdown;
    // Collect ALL cards/chips with a real key id (including hidden breakdown cards
    // whose draggable="false"). Otherwise cmd_reorder_api_keys would receive an
    // incomplete id list and the backend would drop the omitted keys from config.
    const selector = origin === 'switcher' ? '.key-chip[data-key-id]' : '.breakdown-card[data-key-id]';
    const newOrder = [...containerEl.querySelectorAll(selector)]
      .map(el => el.getAttribute('data-key-id'))
      .filter(id => id && id !== 'ALL');
    dragState.source?.classList.remove('dragging');
    dragState.active = false;
    dragState.source = null;
    dragState.sourceKeyId = null;
    dragState.sourceContainer = null;
    state.reorderDraft = newOrder;
    scheduleRender();
    try {
      await invokeWithTimeout('cmd_reorder_api_keys', { ids: newOrder }, WRITE_IPC_TIMEOUT_MS);
      await loadApiKeys();
    } catch (err) {
      console.error('reorder failed', err);
    } finally {
      state.reorderDraft = null;
      scheduleRender();
    }
  };

  const onDragEnd = () => {
    if (dragState.source) dragState.source.classList.remove('dragging');
    dragState.active = false;
    dragState.source = null;
  };

  ['switcher', 'breakdown'].forEach(origin => {
    const container = origin === 'switcher' ? switcher : breakdown;
    if (!container || container._reorderBound) return;
    container._reorderBound = true;
    container.addEventListener('dragstart', onDragStart(origin));
    container.addEventListener('dragover', onDragOver(origin));
    container.addEventListener('drop', onDrop(origin));
    container.addEventListener('dragend', onDragEnd);
  });
}

function renderModelDetails(data) {
  const tbody = document.getElementById('model-table-body');
  if (!tbody) return;

  if (!data || !data.models || data.models.length === 0) {
    modelDetailsSignature = '';
    const emptyRows = `<tr><td colspan="5" class="model-details-empty">${t('perModelEmpty')}</td></tr>`;
    if (tbody.innerHTML !== emptyRows) {
      tbody.innerHTML = emptyRows;
      modelTableHtmlCache.set(tbody, emptyRows);
    }
    const badge = document.getElementById('model-count-badge');
    if (badge) {
      const badgeText = `${t('topItems')} 0 ${t('itemsSuffix')}`;
      if (badge.textContent !== badgeText) {
        badge.textContent = badgeText;
      }
    }
    return;
  }

  const modelLimit = Math.min(state.config?.detail_model_limit || 8, data.models.length);

  const signatureParts = [
    String(modelLimit),
    String(data.last_updated || ''),
  ];
  for (let i = 0; i < modelLimit; i += 1) {
    const model = data.models[i];
    signatureParts.push(
      `${model.name}|${model.used_count}|${model.remaining_count}|${model.total_count}|${model.time_window || ''}`,
    );
  }
  const nextSignature = signatureParts.join('||');
  const modelDataChanged = nextSignature !== modelDetailsSignature;
  modelDetailsSignature = nextSignature;

  if (modelDataChanged) {
    const rows = data.models.slice(0, modelLimit).map(model => `
      <tr>
        <td class="model-cell" title="${escapeHtml(model.name)}">${escapeHtml(model.name)}</td>
        <td class="metric-cell used">${formatNumber(model.used_count)}</td>
        <td class="metric-cell remaining">${formatNumber(model.remaining_count)}</td>
        <td class="metric-cell total">${formatNumber(model.total_count)}</td>
        <td class="window-cell">${escapeHtml(model.time_window || '00:00 ~ 00:00')}</td>
      </tr>
    `).join('');

    if (modelTableHtmlCache.get(tbody) !== rows) {
      tbody.innerHTML = rows;
      modelTableHtmlCache.set(tbody, rows);
    }
  }

  // Update badge
  const badge = document.getElementById('model-count-badge');
  if (badge) {
    const badgeText = `${t('topItems')} ${modelLimit} ${t('itemsSuffix')}`;
    if (badge.textContent !== badgeText) {
      badge.textContent = badgeText;
    }
  }

  // Update timestamp
  const updated = document.getElementById('model-updated');
  if (updated) {
    const updatedText = `${t('modelDetails')}${t('unknown')}: ${data.last_updated || t('na')}`;
    if (updated.textContent !== updatedText) {
      updated.textContent = updatedText;
    }
  }
}

function updateProgressBar(cardId, progressId, percent, status, options = {}) {
  const card = document.getElementById(cardId);
  const progress = document.getElementById(progressId);
  const normalizedStatus = status || 'normal';
  const isWeeklyProgress = progressId === 'weekly-progress';
  const isSingleKey = document.getElementById('dashboard')?.classList.contains('single-key');

  setElementClass(card, `cyber-card ${isWeeklyProgress ? 'secondary ' : ''}${normalizedStatus}`);
  if (progress) {
    const safePercent = clampPercent(percent);
    const width = `${safePercent}%`;
    if (progress.style.width !== width) {
      progress.style.width = width;
    }

    // 显式设置 background，按状态区分颜色（替代 HTML 中的内联 background）
    let background;
    if (normalizedStatus === 'critical') {
      background = 'var(--danger)';
    } else if (normalizedStatus === 'warning') {
      background = 'var(--warning)';
    } else if (isSingleKey) {
      // 单 key 视图 normal 状态跟随 key 颜色
      background = 'var(--key-color)';
    } else if (isWeeklyProgress) {
      background = 'linear-gradient(90deg, #8b5cf6, var(--secondary))';
    } else {
      background = 'linear-gradient(90deg, #3b82f6, var(--primary))';
    }
    progress.style.background = background;

    const lowUsageClass = safePercent > 0 && safePercent < 6 ? ' low-usage' : '';
    setElementClass(progress, `progress-thumb ${isWeeklyProgress ? 'secondary ' : ''}${normalizedStatus}${lowUsageClass}`);
  }

  const marker = document.getElementById(`${progressId}-time-marker`);
  if (marker) {
    const timePercent = typeof options.timePercent === 'number'
      ? clampPercent(options.timePercent)
      : null;
    marker.style.display = timePercent === null ? 'none' : 'block';
    if (timePercent !== null) {
      marker.style.left = `${timePercent}%`;
      const usagePercent = clampPercent(percent);
      setElementClass(marker, `progress-time-marker ${usagePercent > timePercent ? 'ahead' : 'behind'}`);
    }
  }
}

function updateRemainingBreath(valueId, wrapperId, status) {
  const valueEl = document.getElementById(valueId);
  const wrapper = document.getElementById(wrapperId);

  setElementClass(valueEl, `data-value success remaining-breath ${status}`);
  setElementClass(wrapper, `data-item breathing-metric ${status}`);
}

const flipTimers = new WeakMap();

function setFlipNumber(containerId, valueId, nextValue) {
  const valueEl = document.getElementById(valueId);
  if (!valueEl) return;

  const container = document.getElementById(containerId);
  const next = String(nextValue);

  if (!container) {
    valueEl.textContent = next;
    return;
  }

  const previous = container.dataset.value;
  const changed = previous !== next;
  container.dataset.value = next;

  if (!changed) return;

  valueEl.textContent = next;
  if (!previous) return;

  container.classList.remove('flipping');
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        container.classList.add('flipping');
      });
    });
  } else {
    setTimeout(() => {
      container.classList.add('flipping');
    }, 0);
  }

  const timer = flipTimers.get(container);
  if (timer) clearTimeout(timer);
  const cleanupTimer = setTimeout(() => {
    container.classList.remove('flipping');
  }, 2020);
  flipTimers.set(container, cleanupTimer);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const next = String(value);
  if (el.textContent !== next) {
    el.textContent = next;
  }
}

function formatNumber(value) {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat().format(value);
}

function formatRemainingQuota(entry) {
  if (!entry) return '-';
  return `${formatNumber(entry.remaining)}/${formatNumber(entry.total)} (${Math.round(entry.remainingRatio * 100)}%)`;
}

// ── multi-key helpers ───────────────────────────────────────────────────────

function getVisibleKeys() {
  return (state.apiKeys || []).filter(k => k && k.is_active !== false);
}

function getKeyById(id) {
  if (!id || id === 'ALL') return null;
  return (state.apiKeys || []).find(k => k && k.id === id) || null;
}

function getAggregateMetrics() {
  const totals = {
    used: 0, remaining: 0, total: 0,
    weeklyUsed: 0, weeklyRemaining: 0, weeklyTotal: 0,
    usedPercent: null,
    weeklyUsedPercent: null,
    earliestReset: 0, earliestWeeklyReset: 0,
    primaryModel: '', intervalLabel: '',
    hasData: false,
  };
  getVisibleKeys().forEach(key => {
    const data = state.usageData[key.id];
    if (!data || !data.ok) return;
    totals.hasData = true;
    totals.used += data.used_count || 0;
    totals.remaining += data.remaining_count || 0;
    totals.total += data.total_count || 0;
    totals.weeklyUsed += data.weekly_used_count || 0;
    totals.weeklyRemaining += data.weekly_remaining_count || 0;
    totals.weeklyTotal += data.weekly_total_count || 0;
    if (typeof data.used_percent === 'number' && Number.isFinite(data.used_percent)) {
      const pct = clampPercent(data.used_percent);
      totals.usedPercent = totals.usedPercent === null
        ? pct
        : Math.max(totals.usedPercent, pct);
    }
    if (typeof data.weekly_used_percent === 'number' && Number.isFinite(data.weekly_used_percent)) {
      const pct = clampPercent(data.weekly_used_percent);
      totals.weeklyUsedPercent = totals.weeklyUsedPercent === null
        ? pct
        : Math.max(totals.weeklyUsedPercent, pct);
    }
    if (data.reset_timestamp && (totals.earliestReset === 0 || data.reset_timestamp < totals.earliestReset)) {
      totals.earliestReset = data.reset_timestamp;
    }
    if (data.weekly_reset_timestamp && (totals.earliestWeeklyReset === 0 || data.weekly_reset_timestamp < totals.earliestWeeklyReset)) {
      totals.earliestWeeklyReset = data.weekly_reset_timestamp;
    }
    if (!totals.primaryModel && data.primary_model_name) {
      totals.primaryModel = data.primary_model_name;
      totals.intervalLabel = data.interval_label || '';
    }
  });
  return totals;
}

function getAggregatePercent() {
  const m = getAggregateMetrics();
  if (!m.total) return m.usedPercent ?? 0;
  return clampPercent((m.used / m.total) * 100);
}

function percentFromUsage(data, usedField, totalField, percentField) {
  if (!data || !data.ok) return 0;
  const reportedPercent = data[percentField];
  if (typeof reportedPercent === 'number' && Number.isFinite(reportedPercent)) {
    return clampPercent(reportedPercent);
  }

  const used = data[usedField];
  const total = data[totalField];
  if (typeof used !== 'number' || typeof total !== 'number' || total <= 0) {
    return 0;
  }
  return clampPercent((used / total) * 100);
}

function percentFromRemaining(data, remainingField, totalField, percentField) {
  if (!data || !data.ok) return 0;
  const reportedPercent = data[percentField];
  if (typeof reportedPercent === 'number' && Number.isFinite(reportedPercent)) {
    return clampPercent(reportedPercent);
  }

  const remaining = data[remainingField];
  const total = data[totalField];
  if (typeof remaining !== 'number' || typeof total !== 'number' || total <= 0) {
    return 0;
  }
  return clampPercent((remaining / total) * 100);
}

function getQuotaRiskCandidates(data) {
  if (!data || !data.ok) return [];

  const candidates = [];
  const addCandidate = (remaining, total, kind, remainingPercent = null) => {
    if (typeof remaining !== 'number' || typeof total !== 'number' || total <= 0) {
      return;
    }
    const normalizedRemaining = Math.max(0, remaining);
    const remainingRatio = typeof remainingPercent === 'number' && Number.isFinite(remainingPercent)
      ? clampPercent(remainingPercent) / 100
      : normalizedRemaining / total;
    candidates.push({
      remaining: normalizedRemaining,
      total,
      remainingRatio,
      kind,
    });
  };

  addCandidate(data.remaining_count, data.total_count, 'current');
  addCandidate(data.weekly_remaining_count, data.weekly_total_count, 'weekly', data.weekly_remaining_percent);

  return candidates;
}

function pickLowestRemainingRatioCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  return candidates.reduce((lowest, candidate) => {
    if (candidate.remainingRatio < lowest.remainingRatio) return candidate;
    if (
      candidate.remainingRatio === lowest.remainingRatio &&
      candidate.remaining < lowest.remaining
    ) {
      return candidate;
    }
    return lowest;
  }, candidates[0]);
}

function formatMetricScale(percent) {
  return (clampPercent(percent) / 100).toFixed(4);
}

function maskApiKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (s.length <= 4) return '*'.repeat(s.length);
  if (s.length <= 10) return s.slice(0, 2) + '...' + s.slice(-2);
  return s.slice(0, 6) + '...' + s.slice(-4);
}

function formatRelative(epochSeconds) {
  if (!epochSeconds) return '';
  const now = Math.floor(Date.now() / 1000);
  const delta = Math.max(0, now - Math.floor(Number(epochSeconds)));
  if (delta < 60) return t('syncedAgo').replace('{rel}', `${delta}${t('secondAgoUnit')}`);
  if (delta < 3600) return t('syncedAgo').replace('{rel}', `${Math.floor(delta / 60)}${t('minuteAgoUnit')}`);
  if (delta < 86400) return t('syncedAgo').replace('{rel}', `${Math.floor(delta / 3600)}${t('hourAgoUnit')}`);
  return t('syncedAgo').replace('{rel}', `${Math.floor(delta / 86400)}${t('dayAgoUnit')}`);
}

function parseLastUpdatedToEpoch(lastUpdated) {
  if (!lastUpdated || typeof lastUpdated !== 'string') return 0;
  // Backend emits "YYYY-MM-DD HH:MM:SS" in local time (Local::now().format(...)).
  // Parse explicitly to avoid relying on Date.parse's implementation-defined
  // handling of the space-separated form.
  const m = lastUpdated.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const ts = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
    if (Number.isFinite(ts)) return Math.floor(ts / 1000);
  }
  const fallback = Date.parse(lastUpdated);
  if (Number.isFinite(fallback)) return Math.floor(fallback / 1000);
  return 0;
}

function safeKeyColor(color) {
  if (typeof color !== 'string') return '#00d4ff';
  const trimmed = color.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
  return '#00d4ff';
}

function hexToRgba(color, alpha) {
  const hex = safeKeyColor(color).replace('#', '');
  const value = hex.length === 3
    ? hex.split('').map(c => c + c).join('')
    : hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clampPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function getWeeklyCycleTimePercent(resetTimestamp, now = Date.now()) {
  const reset = Number(resetTimestamp);
  if (!Number.isFinite(reset) || reset <= 0) return null;

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const start = reset - weekMs;
  return clampPercent(((now - start) / weekMs) * 100);
}

function getStatus(percent) {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return 'normal';
}

function getRemainingStatus(percent) {
  if (percent <= 10) return 'critical';
  if (percent <= 30) return 'warning';
  return 'normal';
}

function escapeHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let countdownInterval = null;
let autoRefreshInterval = null;
const countdownTargets = [];

function syncCountdownTargets() {
  countdownTargets.length = 0;
  document.querySelectorAll('[data-timestamp]').forEach((el) => {
    countdownTargets.push(el);
  });
}

function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  syncCountdownTargets();
  countdownInterval = setInterval(() => {
    countdownTargets.forEach((el) => {
      const ts = parseInt(el.getAttribute('data-timestamp'), 10);
      if (ts > 0) {
        const nextText = formatCountdown(ts);
        if (el.textContent !== nextText) {
          el.textContent = nextText;
        }
      }
    });
  }, 1000);
}

function restartAutoRefreshTimer() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }

  // Native backend owns periodic refresh so the tray title keeps updating
  // even when the WebView window is hidden or throttled.
}

// Multi-key functions
async function loadApiKeys() {
  if (!tauriInvoke) return;
  try {
    const keys = await invokeWithTimeout('cmd_get_api_keys', undefined, BOOT_IPC_TIMEOUT_MS);
    state.apiKeys = keys || [];
    try {
      const last = localStorage.getItem('lastSelectedKeyId');
      if (last && (last === 'ALL' || state.apiKeys.some(k => k.id === last))) {
        state.selectedKeyId = last;
      } else if (state.apiKeys.length === 1) {
        state.selectedKeyId = state.apiKeys[0].id;
      } else {
        state.selectedKeyId = 'ALL';
      }
    } catch (_) { state.selectedKeyId = 'ALL'; }
    scheduleRender();
  } catch (e) {
    console.error('Failed to load API keys:', e);
    state.apiKeys = [];
    scheduleRender();
  }
}

async function loadAllUsageData() {
  if (!tauriInvoke) return;
  try {
    const allData = await invokeWithTimeout('cmd_get_all_usage_data', undefined, BOOT_IPC_TIMEOUT_MS);
    state.usageData = allData || {};
  } catch (e) {
    console.error('Failed to load usage data:', e);
    state.usageData = {};
  }
}

// Key management modal functions
function showKeyManagementModal() {
  if (!canOpenTransientDialog()) return;
  const modal = document.getElementById('key-management-modal');
  if (!modal) return;

  closeTransientDialogs();
  renderKeyList();
  setDialogVisibility('key-management-modal', true);
}

function renderKeyList() {
  const container = document.getElementById('key-list');
  if (!container) return;

  if (state.apiKeys.length === 0) {
    container.innerHTML = `<div class="empty-state" style="display: block; margin: 0; padding: 40px 20px;">
      <p style="margin: 0;">${escapeHtml(t('noApiKeysConfigured'))}</p>
    </div>`;
    return;
  }

  const rows = state.apiKeys.map(key => `
    <tr>
      <td>
        <div class="key-name-cell">
          <span class="key-color-dot" style="background: ${escapeHtml(key.color || '#00d4ff')};"></span>
          <div class="key-name-stack">
            <div class="key-name" title="${escapeHtml(key.name || t('unknown'))}">${escapeHtml(key.name || t('unknown'))}</div>
            <div class="key-time">${escapeHtml(formatKeyCreatedAt(key.created_at))} | ${escapeHtml(formatKeyInterval(key.refresh_interval))}</div>
          </div>
        </div>
      </td>
      <td><span class="key-mask">${escapeHtml(key.masked_key || '--')}</span></td>
      <td class="key-table-actions">
        <div class="key-row-actions">
          <button class="key-action-button edit js-edit-key" data-key-id="${escapeHtml(key.id)}">${escapeHtml(t('editAction'))}</button>
          <button class="key-action-button delete js-delete-key" data-key-id="${escapeHtml(key.id)}">${escapeHtml(t('deleteAction'))}</button>
        </div>
      </td>
    </tr>
  `).join('');

  container.innerHTML = `
    <table class="key-table">
      <thead>
        <tr>
          <th class="key-table-name">${escapeHtml(t('keyNameTime'))}</th>
          <th class="key-table-mask">${escapeHtml(t('keyMask'))}</th>
          <th class="key-table-actions">${escapeHtml(t('keyActions'))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function openKeyEditDialog(keyId = null) {
  if (!canOpenTransientDialog()) return;
  const dialog = document.getElementById('key-edit-dialog');
  const title = document.getElementById('key-edit-title');
  const idInput = document.getElementById('key-edit-id');
  const nameInput = document.getElementById('key-edit-name');
  const colorInput = document.getElementById('key-edit-color');
  const intervalInput = document.getElementById('key-edit-interval');
  const currentQuotaInput = document.getElementById('key-edit-current-quota');
  const weeklyQuotaInput = document.getElementById('key-edit-weekly-quota');
  const apiKeyInput = document.getElementById('key-edit-api-key');
  const endpointSelect = document.getElementById('key-edit-endpoint');

  // 动态设置 endpoint option 文本（i18n）
  if (endpointSelect) {
    endpointSelect.querySelectorAll('option').forEach(opt => {
      const i18nKey = opt.getAttribute('data-i18n');
      if (i18nKey) opt.textContent = t(i18nKey);
    });
  }

  if (keyId) {
    // Edit mode
    const key = state.apiKeys.find(k => k.id === keyId);
    if (key) {
      title.textContent = t('editApiKeyTitle');
      idInput.value = key.id;
      nameInput.value = key.name;
      colorInput.value = key.color;
      intervalInput.value = key.refresh_interval;
      currentQuotaInput.value = String(normalizeQuotaCount(
        key.current_quota_count,
        DEFAULT_CONFIG.current_quota_count,
      ));
      weeklyQuotaInput.value = String(normalizeQuotaCount(
        key.weekly_quota_count,
        DEFAULT_CONFIG.weekly_quota_count,
      ));
      if (endpointSelect) endpointSelect.value = key.endpoint || 'domestic';
      apiKeyInput.type = 'text';
      apiKeyInput.value = key.masked_key || '';
      apiKeyInput.dataset.maskedKey = key.masked_key || '';
      apiKeyInput.placeholder = key.masked_key || 'API Key';
    }
  } else {
    // Add mode
    title.textContent = t('addApiKeyTitle');
    idInput.value = '';
    nameInput.value = '';
    colorInput.value = '#00d4ff';
    intervalInput.value = '20';
    currentQuotaInput.value = String(DEFAULT_CONFIG.current_quota_count);
    weeklyQuotaInput.value = String(DEFAULT_CONFIG.weekly_quota_count);
    if (endpointSelect) endpointSelect.value = 'domestic';
    apiKeyInput.type = 'password';
    apiKeyInput.value = '';
    apiKeyInput.dataset.maskedKey = '';
    apiKeyInput.placeholder = 'API Key';
  }

  setDialogVisibility('key-edit-dialog', true);
}

function closeKeyEditDialog() {
  setDialogVisibility('key-edit-dialog', false);
}

window.addEventListener('focus', () => {
  closeTransientDialogs();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    closeTransientDialogs();
  }
});

async function saveKeyEdit() {
  const id = document.getElementById('key-edit-id').value;
  const name = document.getElementById('key-edit-name').value.trim();
  const color = document.getElementById('key-edit-color').value;
  const interval = parseInt(document.getElementById('key-edit-interval').value) || 20;
  const currentQuotaCount = normalizeQuotaCount(
    document.getElementById('key-edit-current-quota')?.value,
    DEFAULT_CONFIG.current_quota_count,
  );
  const weeklyQuotaCount = normalizeQuotaCount(
    document.getElementById('key-edit-weekly-quota')?.value,
    DEFAULT_CONFIG.weekly_quota_count,
  );
  const apiKeyInput = document.getElementById('key-edit-api-key');
  const maskedKey = apiKeyInput.dataset.maskedKey || '';
  const rawApiKey = apiKeyInput.value.trim();
  const apiKey = id && rawApiKey === maskedKey ? '' : rawApiKey;
  const endpoint = document.getElementById('key-edit-endpoint')?.value || 'domestic';

  console.log('[saveKeyEdit] Starting, id:', id, 'name:', name);
  
  if (!name) {
    console.warn('[saveKeyEdit] Name is empty');
    alert(state.language === 'zh-CN' ? 'Please enter a name' : 'Please enter a name');
    return;
  }

  if (!tauriInvoke) {
    console.error('[saveKeyEdit] Tauri API not ready');
    alert(state.language === 'zh-CN' ? 'System not ready, please wait' : 'System not ready, please wait');
    return;
  }

  try {
    if (id) {
      console.log('[saveKeyEdit] Updating existing key:', id);
      await invokeWithTimeout('cmd_update_api_key', {
        id, name, color, refreshInterval: interval, currentQuotaCount, weeklyQuotaCount, apiKey: apiKey || null, endpoint
      }, WRITE_IPC_TIMEOUT_MS);
      console.log('[saveKeyEdit] Update successful');
    } else {
      if (!apiKey) {
        console.warn('[saveKeyEdit] API key is empty');
        alert(state.language === 'zh-CN' ? 'Please enter an API key' : 'Please enter an API key');
        return;
      }
      console.log('[saveKeyEdit] Adding new key, name:', name);
      const result = await invokeWithTimeout('cmd_add_api_key', {
        name, color, apiKey: apiKey, refreshInterval: interval, currentQuotaCount, weeklyQuotaCount, endpoint
      }, WRITE_IPC_TIMEOUT_MS);
      console.log('[saveKeyEdit] Add successful, result:', result);
    }
    closeKeyEditDialog();
    await loadApiKeys();
    await loadAllUsageData();
    renderKeyList();
    scheduleRender();
    runInBackground('refresh after key edit', refreshAllUsage);
  } catch (e) {
    console.error('[saveKeyEdit] Error:', e);
    alert(state.language === 'zh-CN' ? 'Failed to save: ' + e : 'Failed to save: ' + e);
  }
}

function formatKeyInterval(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval <= 0) return '--s';
  return `${interval}s`;
}

function formatKeyCreatedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '--';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

// 显示自定义确认对话框
function showConfirmDialog(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 99999;';
  
  const dialog = document.createElement('div');
  dialog.style.cssText = 'background: #1a1a2e; padding: 24px; border-radius: 12px; max-width: 400px; text-align: center;';
  
  dialog.innerHTML = `
    <h3 style="margin: 0 0 16px 0; color: white;">${title}</h3>
    <p style="margin: 0 0 24px 0; color: #94a3b8;">${message}</p>
    <div style="display: flex; gap: 12px; justify-content: center;">
      <button id="confirm-cancel" style="padding: 10px 24px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
      <button id="confirm-ok" style="padding: 10px 24px; background: #ff2e63; color: white; border: none; border-radius: 6px; cursor: pointer;">Delete</button>
    </div>
  `;
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  document.getElementById('confirm-cancel').onclick = () => {
    document.body.removeChild(overlay);
    onConfirm(false);
  };
  
  document.getElementById('confirm-ok').onclick = () => {
    document.body.removeChild(overlay);
    onConfirm(true);
  };
  
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
      onConfirm(false);
    }
  };
}

async function deleteKey(keyId) {
  console.log('[deleteKey] Starting, keyId:', keyId);
  
  // 使用自定义确认框而不是 confirm()
  return new Promise((resolve) => {
    showConfirmDialog(
      t('deleteKeyTitle'),
      t('deleteKeyMessage'),
      async (confirmed) => {
        console.log('[deleteKey] Confirm result:', confirmed);
        
        if (!confirmed) {
          console.log('[deleteKey] User cancelled');
          resolve();
          return;
        }

        console.log('[deleteKey] User confirmed, tauriInvoke:', typeof tauriInvoke);
        
        if (!tauriInvoke) {
          console.error('[deleteKey] Tauri API not ready');
          alert(state.language === 'zh-CN' ? 'System not ready, please wait' : 'System not ready, please wait');
          resolve();
          return;
        }
        
        console.log('[deleteKey] Calling backend with { id:', keyId, '}');
        
        try {
          console.log('[deleteKey] Invoking cmd_delete_api_key...');
          const result = await invokeWithTimeout('cmd_delete_api_key', { id: keyId }, WRITE_IPC_TIMEOUT_MS);
          console.log('[deleteKey] Delete successful, result:', result);
          await loadApiKeys();
          await loadAllUsageData();
          renderKeyList();
          scheduleRender();
        } catch (e) {
          console.error('[deleteKey] Error:', e);
          alert(state.language === 'zh-CN' ? 'Failed to delete: ' + e : 'Failed to delete: ' + e);
        } finally {
          resolve();
        }
      }
    );
  });
}

function formatCountdown(timestamp) {
  if (!timestamp || timestamp <= 0) return '';
  const now = Date.now();
  const diff = timestamp - now;
  if (diff <= 0) return '00:00:00';

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Auto-update dialog ──────────────────────────────────────────────────────

function showUpdateDialog() {
  const dialog = document.getElementById('update-dialog');
  if (!dialog) return;
  // 升级对话框优先级最高 — 关闭其它瞬态对话框避免遮挡
  closeTransientDialogs();
  setDialogVisibility('update-dialog', true);
  renderUpdateDialog();
}

function hideUpdateDialog() {
  const dialog = document.getElementById('update-dialog');
  if (!dialog) return;
  setDialogVisibility('update-dialog', false);
  // 用户点"稍后"后清掉 pendingUpdate,避免下次后端再次 emit 时不弹窗
  if (!state.updateDownloading) {
    state.pendingUpdate = null;
    state.updateDownloadFinished = false;
  }
}

function renderUpdateDialog(options = {}) {
  const update = state.pendingUpdate;
  if (!update) return;

  const versionEl = document.getElementById('update-version');
  if (versionEl) versionEl.textContent = `v${update.version}`;

  const notesEl = document.getElementById('update-notes');
  if (notesEl) {
    notesEl.textContent = update.notes && update.notes.trim()
      ? update.notes
      : t('updateAlreadyLatest');
  }

  const progressBox = document.getElementById('update-progress');
  const progressFill = document.getElementById('update-progress-fill');
  if (progressBox) {
    const showProgress = state.updateDownloading && !state.updateDownloadFinished;
    progressBox.style.display = showProgress ? 'block' : 'none';
    if (showProgress) {
      const pct = typeof options.progressPercent === 'number'
        ? Math.max(0, Math.min(100, options.progressPercent))
        : 0;
      if (progressFill) progressFill.style.width = `${pct}%`;
    }
  }

  const finishedHint = document.getElementById('update-finished-hint');
  if (finishedHint) {
    finishedHint.style.display = state.updateDownloadFinished ? 'block' : 'none';
  }

  const nowBtn = document.getElementById('btn-update-now');
  const laterBtn = document.getElementById('btn-update-later');
  if (nowBtn) {
    if (state.updateDownloadFinished) {
      nowBtn.disabled = false;
      nowBtn.textContent = state.language === 'zh-CN' ? '立即重启' : 'Restart now';
    } else {
      nowBtn.disabled = state.updateDownloading;
      nowBtn.textContent = t('updateNow');
    }
  }
  if (laterBtn) {
    laterBtn.disabled = state.updateDownloading;
  }
}

async function startUpdateDownload() {
  const update = state.pendingUpdate;
  if (!update || !tauriInvoke) return;
  if (state.updateDownloadFinished) {
    // 用户点击"立即重启"
    try {
      await invokeWithTimeout('cmd_restart_app', undefined, WRITE_IPC_TIMEOUT_MS);
    } catch (e) {
      console.error('Failed to restart app:', e);
    }
    return;
  }
  if (state.updateDownloading) return;
  try {
    await invokeWithTimeout(
      'cmd_download_and_install_update',
      { version: update.version },
      WRITE_IPC_TIMEOUT_MS,
    );
    // 后端会通过 update-download-started/progress/finished 事件回报
  } catch (error) {
    console.error('Failed to start update download:', error);
    alert(t('updateDownloadFailed'));
    hideUpdateDialog();
  }
}

