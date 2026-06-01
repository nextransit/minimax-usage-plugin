import * as https from "https";
import * as vscode from "vscode";
import {
  buildCompactStatusText,
  buildCompactTooltipTable,
  formatEnglishCountdownFriendly,
  formatEnglishDurationCompact,
  getCompactTooltipLabels,
  selectCompactProgressColor,
  selectCompactStateIcon,
  selectCompactStatusIcon,
} from "./compactView";
import { multiKeyState, ApiKeyEntry } from "./multiKeyState";
import { SecretStore } from "./secretStore";
import * as fs from "fs";

const ENDPOINT_BASE_URLS: Record<string, string> = {
  domestic: "https://www.minimaxi.com",
  overseas: "https://www.minimax.io",
};

const LEGACY_ENDPOINT_BASE_URLS: Record<string, string> = {
  domestic: "https://www.minimaxi.com",
  overseas: "https://platform.minimax.io",
};

function getTokenPlanEndpointUrl(endpoint?: string): string {
  const base = ENDPOINT_BASE_URLS[endpoint || "domestic"] || ENDPOINT_BASE_URLS.domestic;
  return `${base}/v1/token_plan/remains`;
}

function getLegacyCodingPlanEndpointUrl(endpoint?: string): string {
  const base = LEGACY_ENDPOINT_BASE_URLS[endpoint || "domestic"] || LEGACY_ENDPOINT_BASE_URLS.domestic;
  return `${base}/v1/api/openplatform/coding_plan/remains`;
}

type ModelRemain = {
  start_time?: number;
  end_time?: number;
  remains_time?: number;
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  current_interval_remaining_percent?: number;
  model_name?: string;
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;
  current_weekly_remaining_percent?: number;
  weekly_remains_time?: number;
};

type MiniMaxRawPayload = {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  status_code?: number;
  status_msg?: string;
  model_remains?: ModelRemain[];
};

type UsageViewModel = {
  ok: boolean;
  statusLabel: string;
  primaryModelName: string;
  minRemainingModelName: string;
  minRemainingWindow: "current" | "weekly";
  timeWindow: string;
  resetInLabel: string;
  resetTimestamp: number | null;
  totalCount: number | null;
  remainingCount: number | null;
  minRemainingCount: number | null;
  usedCount: number | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  weeklyTotalCount: number | null;
  weeklyUsedCount: number | null;
  weeklyRemainingCount: number | null;
  weeklyUsedPercent: number | null;
  weeklyRemainingPercent: number | null;
  weeklyResetTimestamp: number | null;
  weeklyResetInLabel: string;
  intervalLabel: string;
  models: Array<{
    name: string;
    timeWindow: string;
    totalCount: number;
    remainingCount: number;
    usedCount: number;
  }>;
  raw: unknown;
};

type RemainsResult = {
  ok: boolean;
  statusCode: number | null;
  summary: string;
  raw: unknown;
  usageCountSemantics: "used" | "remaining";
};

type LanguagePreference = "auto" | "zh-CN" | "en";
type UiLanguage = "zh-CN" | "en";

type ExtensionConfig = {
  refreshIntervalSeconds: number;
  showWeeklyInStatusBar: boolean;
  detailModelLimit: number;
  statusBarAlignment: "left" | "right";
  requestTimeoutMs: number;
  language: LanguagePreference;
};

type StatusItemSpec = {
  alignment: vscode.StatusBarAlignment;
  priority: number;
  text: string;
  tooltip?: vscode.MarkdownString | string;
  command?: string;
  color?: string | vscode.ThemeColor;
  backgroundColor?: vscode.ThemeColor;
};

type QuotaRiskWindow = "current" | "weekly";

type QuotaRiskCandidate = {
  remainingCount: number;
  totalCount: number;
  remainingRatio: number;
  window: QuotaRiskWindow;
  modelName: string;
};

type ManagedStatusItem = {
  item: vscode.StatusBarItem;
  alignment: vscode.StatusBarAlignment;
  priority: number;
  cachedTooltipRaw?: string;
};

let contextRef: vscode.ExtensionContext | undefined;
let statusItems: ManagedStatusItem[] = [];
let output: vscode.OutputChannel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let countdownTimer: NodeJS.Timeout | undefined;
let latestVm: UsageViewModel | null = null;
let latestRawResponse: unknown = null;
let lastUpdatedAt: Date | null = null;
let isRefreshing = false;
const alertedRiskWindows = new Set<string>();
const RISK_REMAINING_RATIO_THRESHOLD = 0.10;
let detailsPanel: vscode.WebviewPanel | undefined;
let hasShownWelcomeThisSession = false;
const emptyUsageViewModel = {
  primaryModelName: "",
  minRemainingModelName: "",
  minRemainingWindow: "current",
  timeWindow: "",
  resetInLabel: "",
  resetTimestamp: null,
  totalCount: null,
  remainingCount: null,
  minRemainingCount: null,
  usedCount: null,
  usedPercent: null,
  remainingPercent: null,
  weeklyTotalCount: null,
  weeklyUsedCount: null,
  weeklyRemainingCount: null,
  weeklyUsedPercent: null,
  weeklyRemainingPercent: null,
  weeklyResetTimestamp: null,
  weeklyResetInLabel: "",
  intervalLabel: "",
  models: [],
} satisfies Omit<UsageViewModel, "ok" | "statusLabel" | "raw">;

function resolveUiLanguage(config: ExtensionConfig = readConfig()): UiLanguage {
  if (config.language === "zh-CN" || config.language === "en") {
    return config.language;
  }

  return vscode.env.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function getRuntimeStrings(config: ExtensionConfig = readConfig()) {
  const language = resolveUiLanguage(config);
  const isEn = language === "en";

  return {
    language,
    isEn,
    outputChannelName: "MiniMax Monitor",
    inputBoxTitle: "MiniMax Monitor",
    inputBoxPrompt: isEn ? "Enter MiniMax API Key" : "输入 MiniMax API Key",
    inputBoxPlaceholder: "API Key",
    infoApiKeySaved: isEn ? "MiniMax API key saved" : "MiniMax API Key 已保存",
    infoApiKeyCleared: isEn ? "MiniMax API key cleared" : "MiniMax API Key 已清除",
    infoRawCopied: isEn ? "MiniMax raw response copied to clipboard" : "MiniMax 原始响应已复制到剪贴板",
    welcomeTitle:
      isEn
        ? "Welcome to MiniMax Monitor! Configure your access token to get started. Multiple API keys are supported."
        : "欢迎使用 MiniMax Monitor！需要配置您的访问令牌才能开始使用。可以设置多个 API KEY。",
    welcomeConfigure: isEn ? "Configure Now" : "立即配置",
    welcomeLater: isEn ? "Later" : "稍后设置",
    warnNoRawResponse: isEn ? "There is no raw response to copy yet" : "当前没有可复制的原始响应",
    warnSetApiKeyFirst: isEn ? "Please run \"MiniMax Monitor: Set API Key\" first" : "请先运行 “MiniMax Monitor: Set API Key”",
    warnRiskLowQuota:
      isEn
        ? "MiniMax risk warning: current window has only "
        : "MiniMax 风险提示: 当前周期剩余请求次数仅 ",
    warnRiskLowQuotaSuffix:
      isEn
        ? " requests left. Consider lowering request frequency or switching models."
        : " 次，即将耗尽！建议降低请求频率或切换模型。",
    warnRiskLowQuotaWeekly:
      isEn
        ? "MiniMax risk warning: weekly quota has only "
        : "MiniMax 风险提示: 本周剩余请求次数仅 ",
    warnRiskLowQuotaWeeklySuffix:
      isEn
        ? " requests left this week. Consider lowering request frequency or switching models."
        : " 次，本周即将耗尽！建议降低请求频率或切换模型。",
    errorQueryFailedPrefix: isEn ? "MiniMax query failed: " : "MiniMax 查询失败：",
    errorQueryExceptionPrefix: isEn ? "MiniMax query error: " : "MiniMax 查询异常：",
    errorUnknown: isEn ? "Unknown error" : "未知错误",
    statusQuerying: isEn ? "$(sync~spin) MiniMax: Querying..." : "$(sync~spin) MiniMax 查询中...",
    statusQueryingCompact: isEn ? "Refreshing..." : "刷新中...",
    statusSetApiKey: isEn ? "$(key) MiniMax: Set API Key" : "$(key) MiniMax: 设置 API Key",
    statusSetApiKeyCompact: isEn ? "Set API Key" : "设置 API Key",
    statusWaitingRefresh: isEn ? "$(sync) MiniMax: Waiting to refresh" : "$(sync) MiniMax: 等待刷新",
    statusWaitingRefreshCompact: isEn ? "Waiting to refresh" : "等待刷新",
    statusWeekly: isEn ? "  Week: " : "  每周: ",
    tooltipTitle: "MiniMax Token Plan",
    tooltipRefreshing: isEn ? "$(sync~spin) Refreshing data..." : "$(sync~spin) 正在刷新数据...",
    tooltipWaiting: isEn ? "Waiting for the first refresh.  \n" : "等待首次刷新。  \n",
    tooltipMissingKey: isEn ? "API key is not configured.  \n" : "未配置 API Key。  \n",
    actionRefresh: isEn ? "Refresh" : "刷新",
    actionRefreshNow: isEn ? "Refresh now" : "立即刷新",
    actionSetKey: isEn ? "Set Key" : "设置 Key",
    actionSetApiKey: isEn ? "Set API Key" : "设置 API Key",
    actionClearKey: isEn ? "Clear Key" : "清除 Key",
    actionCopyRaw: isEn ? "Copy raw response" : "复制原始响应",
    detailsPanelTitle: isEn ? "MiniMax Monitor Details" : "MiniMax Monitor 详情",
    detailTooltipHeading: isEn ? "MiniMax Token Plan Details" : "MiniMax Token Plan 详细信息",
    detailStatus: isEn ? "Status" : "状态",
    detailPrimaryModel: isEn ? "Primary model" : "主模型",
    detailTimeWindow: isEn ? "Time window" : "时间窗口",
    detailResetCountdown: isEn ? "Window reset countdown" : "窗口重置倒计时",
    detailMetric: isEn ? "Metric" : "指标",
    detailValue: isEn ? "Value" : "数值",
    detailUsed: isEn ? "Used" : "已使用",
    detailRemaining: isEn ? "Remaining" : "剩余",
    detailTotal: isEn ? "Total quota" : "总额度",
    detailWindowProgress: isEn ? "Window progress" : "窗口进度",
    detailWeeklyUsed: isEn ? "Weekly used" : "本周已使用",
    detailWeeklyRemaining: isEn ? "Weekly remaining" : "本周剩余",
    detailWeeklyTotal: isEn ? "Weekly total" : "本周总额度",
    detailWeeklyProgress: isEn ? "Weekly progress" : "本周进度",
    detailWeeklyResetCountdown: isEn ? "Weekly reset countdown" : "本周重置倒计时",
    detailUpdatedAt: isEn ? "Updated at" : "更新时间",
    detailModelDetails: isEn ? "Model details" : "模型明细",
    detailModelListTitle: (limit: number) =>
      isEn ? `Model details (top ${limit} items)` : `模型明细（前 ${limit} 项）`,
    detailTopItemsLabel: isEn ? "top" : "前",
    detailItemsSuffix: isEn ? "items" : "项",
    unknown: isEn ? "Unknown" : "未知",
    unknownModel: isEn ? "Unknown Model" : "未知模型",
    labelSeparator: isEn ? ": " : "：",
    timeZoneSuffix: isEn ? " (UTC+8)" : "（UTC+8）",
    panelUnconfiguredKey: isEn ? "Unconfigured API Key" : "未配置加密密钥",
    panelUnconfiguredDesc:
      isEn
        ? "System core features require MiniMax API Key authorization. Please enter your access key in the console to sync data."
        : "系统核心功能需要 MiniMax API Key 授权。请在控制台中输入您的访问密钥以同步数据。",
    panelInitAccess: isEn ? "INITIALIZE ACCESS" : "配置密钥",
    panelWaitingData: isEn ? "Waiting for Data Link" : "等待数据链路",
    panelWaitingDesc:
      isEn
        ? "Attempting to connect to MiniMax servers and sync the latest Token consumption metrics. Please ensure network connectivity."
        : "正在尝试连接 MiniMax 服务器并同步最新的 Token 消耗指标。请保持网络畅通。",
    panelRetrySync: isEn ? "RETRY SYNC" : "重试同步",
    panelDataBroken: isEn ? "Data Link Broken" : "数据链路中断",
    panelReconnect: isEn ? "RECONNECT" : "重新连接",
    panelEditKey: isEn ? "EDIT KEY" : "修改密钥",
    panelTitle: isEn ? "MINIMAX USAGE PANEL" : "MINIMAX 用量监控",
    panelModel: isEn ? "MODEL" : "当前模型",
    panelWindow: isEn ? "WINDOW" : "时间窗口",
    panelCurrentInterval: isEn ? "CURRENT INTERVAL" : "当前周期",
    panelConsumed: isEn ? "CONSUMED" : "已使用",
    panelAvailable: isEn ? "AVAILABLE" : "剩余量",
    panelLimit: isEn ? "LIMIT" : "总配额",
    panelResourceUtil: isEn ? "RESOURCE UTILIZATION" : "资源使用率",
    panelWeeklyAggregate: isEn ? "WEEKLY AGGREGATE" : "本周累计",
    panelUsed: isEn ? "USED" : "已使用",
    panelLeft: isEn ? "LEFT" : "剩余量",
    panelTotal: isEn ? "TOTAL" : "总额度",
    panelWeeklyQuota: isEn ? "WEEKLY QUOTA" : "本周进度",
    panelModelDetails: isEn ? "MODEL DETAILS" : "模型明细",
    panelTopItems: isEn ? "TOP" : "前",
    panelItemsSuffix: isEn ? "ITEMS" : "项",
    panelPerModelHint: isEn ? "Expand to inspect per-model quotas" : "展开查看各模型额度",
    panelPerModelEmpty: isEn ? "No model detail data available right now." : "当前暂无模型明细数据。",
    panelModelName: isEn ? "MODEL" : "模型",
    panelModelUsed: isEn ? "USED" : "已使用",
    panelModelRemaining: isEn ? "LEFT" : "剩余",
    panelModelTotal: isEn ? "TOTAL" : "总额度",
    panelModelWindow: isEn ? "WINDOW" : "时间窗口",
    panelUpdatedAt: isEn ? "UPDATED AT" : "更新时间",
    panelSyncedAt: isEn ? "SYNCED AT: " : "最后同步: ",
    panelSyncData: isEn ? "SYNC DATA" : "刷新数据",
    panelKeyConfig: isEn ? "KEY CONFIG" : "配置密钥",
    panelRiskTitle: isEn ? "Risk Warning" : "风险提示",
    panelRiskRemaining: isEn ? "Current window remaining only " : "当前窗口剩余仅 ",
    panelRiskExhausted:
      isEn
        ? "Quota is almost exhausted. Suggest lowering request frequency or switching models!"
        : "额度即将耗尽，建议立即降低请求频率或切换模型！",
  panelRiskFast:
  isEn
  ? "Consuming quickly. Please monitor usage to avoid rate limits."
  : "消耗较快，请注意使用配额以避免被限流。",
  languageSwitchLabel: isEn ? "Language" : "语言",
  languageZhCN: isEn ? "中文" : "中文",
  languageEn: isEn ? "English" : "English",
  validationMissingKey: isEn ? "Missing API key" : "缺少 API Key",
    validationInvalidKey: isEn ? "Invalid API key format" : "API Key 格式无效",
    validationShortKey: isEn ? "API key is too short" : "API Key 长度不足",
    fetchSummarySuccess: isEn ? "Success" : "查询成功",
    fetchSummaryCheckApiKey: isEn ? "Please check whether the API key is correct" : "请检查 API Key 是否正确",
    fetchSummaryUnknownResponse: isEn ? "MiniMax returned an unrecognized response" : "MiniMax 返回了未识别响应",
    fetchSummaryRequestFailed: isEn ? "Failed to request MiniMax" : "请求 MiniMax 失败",
    fetchSummaryTimeout: isEn ? "Request timed out, please retry" : "请求超时，请重试",
    invalidJsonMessage: (statusCode: number) =>
      isEn ? `MiniMax returned invalid JSON (HTTP ${statusCode})` : `MiniMax 返回了无效 JSON（HTTP ${statusCode}）`,
    durationDay: isEn ? "d" : "天",
    durationHour: isEn ? "h" : "小时",
    durationMinute: isEn ? "m" : "分钟",
    webviewLang: isEn ? "en" : "zh-CN",
    localeTag: isEn ? "en-US" : "zh-CN",
  } as const;
}

// SecretStore instance (multi-key)
let secretStore: SecretStore | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  contextRef = context;
  output = vscode.window.createOutputChannel(getRuntimeStrings().outputChannelName);
  context.subscriptions.push(output);

  // Initialize multi-key support
  secretStore = new SecretStore(context.secrets);
  await loadMultiKeyState();

  registerCommands(context);

  // Welcome prompt when no API keys are configured
  // Fire-and-forget — don't block activate()
  showWelcomeIfNoKeys();

  // Load keys from config

  recreateStatusBarItem();
  restartRefreshTimer();
  restartCountdownTicker();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration("minimaxUsage")) {
        return;
      }

      const alignmentChanged = event.affectsConfiguration("minimaxUsage.statusBarAlignment");
      const languageChanged = event.affectsConfiguration("minimaxUsage.language");
      const keysChanged = event.affectsConfiguration("minimaxUsage.apiKeys");

      if (alignmentChanged) {
        recreateStatusBarItem();
      }

      if (keysChanged) {
        await loadMultiKeyState();
      }

      if (languageChanged && latestRawResponse) {
        const rebuiltVm = rebuildUsageViewModelFromRaw(latestRawResponse);
        if (rebuiltVm) {
          latestVm = rebuiltVm;
        }
      }

      restartRefreshTimer();
      updateStatusBar();
      pushUsageDataToWebview();
    }),
  );

  // Initial refresh of all active keys
  await refreshAllUsageData();
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }

  if (statusItems.length > 0) {
    for (const entry of statusItems) {
      entry.item.dispose();
    }
    statusItems = [];
  }

  if (detailsPanel) {
    detailsPanel.dispose();
    detailsPanel = undefined;
  }

}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("minimaxUsage.setApiKey", async () => {
      // Forward to addApiKey for multi-key flow
      await vscode.commands.executeCommand("minimaxUsage.addApiKey");
    }),

    vscode.commands.registerCommand("minimaxUsage.clearApiKey", async () => {
      const strings = getRuntimeStrings();
      const confirmed = await vscode.window.showWarningMessage(
        "Delete all API keys?",
        { modal: true },
        "Delete",
        "Cancel",
      );
      if (confirmed !== "Delete") return;
      // Clear all keys from multiKeyState
      const keys = multiKeyState.visibleKeys;
      for (const key of keys) {
        if (secretStore) { await secretStore.deleteKey(key.id); }
      }
      await saveApiKeys([]);
      await setSelectedKey("ALL");
      latestVm = null;
      latestRawResponse = null;
      lastUpdatedAt = null;
      log("All API keys cleared");
      updateStatusBar();
      pushUsageDataToWebview();
      vscode.window.showInformationMessage(strings.infoApiKeyCleared);
    }),

    vscode.commands.registerCommand("minimaxUsage.refresh", async () => {
      await refreshUsage("manual");
    }),

    vscode.commands.registerCommand("minimaxUsage.showDetails", async () => {
      showDetailsPanel();
    }),

    vscode.commands.registerCommand("minimaxUsage.manageApiKeys", async () => {
      showKeyManagementPanel();
    }),

    vscode.commands.registerCommand("minimaxUsage.copyRawResponse", async () => {
      const strings = getRuntimeStrings();
      if (!latestRawResponse) {
        vscode.window.showWarningMessage(strings.warnNoRawResponse);
        return;
      }

      await vscode.env.clipboard.writeText(JSON.stringify(latestRawResponse, null, 2));
      vscode.window.showInformationMessage(strings.infoRawCopied);
    }),

    // Switch to specific key from panel chip
    vscode.commands.registerCommand("minimaxUsage.switchToKey", async (keyId: string) => {
      if (!keyId || typeof keyId !== "string") { return; }
      await setSelectedKey(keyId);
    }),

    // Add new API key
    vscode.commands.registerCommand("minimaxUsage.addApiKey", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Enter a name for this API key",
        placeHolder: "Personal",
        ignoreFocusOut: true,
      });
      if (name === undefined) return;

      const apiKeyInput = await vscode.window.showInputBox({
        prompt: "Enter your MiniMax API key",
        password: true,
        ignoreFocusOut: true,
      });
      if (apiKeyInput === undefined) return;

      const apiKey = apiKeyInput.trim();
      const validation = validateApiKey(apiKey);
      if (!validation.ok) {
        vscode.window.showErrorMessage(validation.message);
        return;
      }

      const newKey = await addApiKey(name, apiKey);
      if (newKey) {
        await refreshUsageForKey(newKey.id, "manual");
        updateStatusBar();
        vscode.window.showInformationMessage(`API key "${name}" added successfully`);
      }
    }),

    // Update API key
    vscode.commands.registerCommand("minimaxUsage.updateApiKey", async (keyId?: string) => {
      const id = keyId || multiKeyState.selectedKeyId;
      if (id === "ALL") {
        vscode.window.showWarningMessage("Please select a specific key to update");
        return;
      }
      const key = multiKeyState.getKeyById(id);
      if (!key) return;

      const name = await vscode.window.showInputBox({
        prompt: "Enter a new name for this API key",
        value: key.name,
        ignoreFocusOut: true,
      });
      if (name === undefined) return;

      const apiKeyInput = await vscode.window.showInputBox({
        prompt: "Enter new API key (leave empty to keep current)",
        password: true,
        ignoreFocusOut: true,
      });

      const updates: Partial<ApiKeyEntry> & { key?: string } = { name };
      if (apiKeyInput && apiKeyInput.trim()) {
        const validation = validateApiKey(apiKeyInput.trim());
        if (!validation.ok) {
          vscode.window.showErrorMessage(validation.message);
          return;
        }
        updates.key = apiKeyInput.trim();
      }

      await updateApiKey(id, updates);
      updateStatusBar();
      vscode.window.showInformationMessage(`API key "${name}" updated`);
    }),

    // Delete API key
    vscode.commands.registerCommand("minimaxUsage.deleteApiKey", async (keyId?: string) => {
      const id = keyId || multiKeyState.selectedKeyId;
      if (id === "ALL") return;
      const key = multiKeyState.getKeyById(id);
      if (!key) return;

      const confirmed = await vscode.window.showWarningMessage(
        `Delete API key "${key.name}"?`,
        { modal: true },
        "Delete",
        "Cancel",
      );
      if (confirmed !== "Delete") return;

      await deleteApiKey(id);
      updateStatusBar();
      vscode.window.showInformationMessage(`API key "${key.name}" deleted`);
    }),

    // Show key switcher (QuickPick)
    vscode.commands.registerCommand("minimaxUsage.showKeySwitcher", async () => {
      const keys = multiKeyState.visibleKeys;
      if (keys.length === 0) {
        vscode.commands.executeCommand("minimaxUsage.addApiKey");
        return;
      }

      const items: vscode.QuickPickItem[] = [
        {
          label: `$(globe) ALL Keys (${multiKeyState.activeKeys.length} active)`,
          description: "Aggregate view of all keys",
          picked: multiKeyState.selectedKeyId === "ALL",
        },
      ];

      for (const key of keys) {
        const data = multiKeyState.getUsageForKey(key.id);
        const percent = data?.usedPercent != null ? `${Math.round(data.usedPercent)}%` : "--";
        items.push({
          label: `$(key) ${key.name}`,
          description: `Usage: ${percent} ${!key.isActive ? "(inactive)" : ""}`,
          picked: multiKeyState.selectedKeyId === key.id,
          buttons: [
            { iconPath: vscode.Uri.parse(""), tooltip: "Edit" },
            { iconPath: vscode.Uri.parse(""), tooltip: "Delete" },
          ],
        });
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select API key to view",
      });

      if (!selected) return;

      if (selected.label.startsWith("$(globe)")) {
        await setSelectedKey("ALL");
      } else {
        for (const key of keys) {
          if (selected.label.includes(key.name)) {
            await setSelectedKey(key.id);
            break;
          }
        }
      }
    }),

    // Refresh all keys
    vscode.commands.registerCommand("minimaxUsage.refreshAll", async () => {
      await refreshAllUsageData();
    }),
  );
}

function clearStatusItems(): void {
  for (const entry of statusItems) {
    entry.item.dispose();
  }
  statusItems = [];
}

function recreateStatusBarItem(): void {
  clearStatusItems();
  updateStatusBar();
}

function addStatusItem(
  specs: StatusItemSpec[],
  alignment: vscode.StatusBarAlignment,
  priority: number,
  text: string,
  tooltip?: vscode.MarkdownString | string,
  command?: string,
  color?: string | vscode.ThemeColor,
  backgroundColor?: vscode.ThemeColor,
): void {
  specs.push({
    alignment,
    priority,
    text,
    tooltip,
    command,
    color,
    backgroundColor,
  });
}

function applyStatusItemSpec(item: vscode.StatusBarItem, spec: StatusItemSpec, existing: ManagedStatusItem): void {
  item.text = spec.text;
  const tooltipKey = typeof spec.tooltip === 'string' ? spec.tooltip : spec.tooltip?.value;
  if (existing.cachedTooltipRaw !== tooltipKey) {
    item.tooltip = spec.tooltip;
    existing.cachedTooltipRaw = tooltipKey;
  }
  item.command = spec.command;
  item.color = spec.color;
  item.backgroundColor = spec.backgroundColor;
  item.show();
}

function renderStatusItems(specs: StatusItemSpec[]): void {
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const existing = statusItems[index];

    if (!existing || existing.alignment !== spec.alignment || existing.priority !== spec.priority) {
      existing?.item.dispose();

      statusItems[index] = {
        item: vscode.window.createStatusBarItem(spec.alignment, spec.priority),
        alignment: spec.alignment,
        priority: spec.priority,
        cachedTooltipRaw: undefined,
      };
    }

    applyStatusItemSpec(statusItems[index].item, spec, statusItems[index]);
  }

  for (let index = specs.length; index < statusItems.length; index += 1) {
    statusItems[index].item.dispose();
  }

  statusItems.length = specs.length;
}

function restartRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  let intervalMs = readConfig().refreshIntervalSeconds * 1000;
  
  // 动态刷新：使用率大于80%时缩短刷新时间至10s
  if (latestVm && latestVm.usedPercent !== null && latestVm.usedPercent > 80) {
    intervalMs = 10000;
  }

  refreshTimer = setInterval(() => {
    void refreshUsage("auto");
  }, intervalMs);
}

function restartCountdownTicker(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }

  countdownTimer = setInterval(() => {
    updateStatusBar();
  }, 1000);
}

// Refresh usage for a specific key
async function refreshUsageForKey(keyId: string, reason: "startup" | "auto" | "manual"): Promise<void> {
  if (!contextRef || isRefreshing) { return; }

  const strings = getRuntimeStrings();
  if (!secretStore) { return; }

  const apiKey = await secretStore.loadKey(keyId);
  if (!apiKey) {
    multiKeyState.updateUsageForKey(keyId, buildErrorViewModel("API key not found"));
    multiKeyState.updateUsageForKey(keyId, {
      ok: false, statusLabel: "API key not found", primaryModelName: "",
      minRemainingModelName: "", minRemainingWindow: "current" as const,
      timeWindow: "", resetInLabel: "", resetTimestamp: null,
      totalCount: null, remainingCount: null, minRemainingCount: null,
      usedCount: null, usedPercent: null, remainingPercent: null, weeklyTotalCount: null,
      weeklyUsedCount: null, weeklyRemainingCount: null, weeklyUsedPercent: null,
      weeklyRemainingPercent: null,
      weeklyResetTimestamp: null, weeklyResetInLabel: "",
      intervalLabel: "", models: [], raw: null,
    });
    updateStatusBar();
    return;
  }

  const validation = validateApiKey(apiKey);
  if (!validation.ok) {
    multiKeyState.updateUsageForKey(keyId, buildErrorViewModel(validation.message));
    updateStatusBar();
    return;
  }

  try {
    isRefreshing = true;
    updateStatusBar();

    const timeoutMs = readConfig().requestTimeoutMs;
    const keyEntry = multiKeyState.getKeyById(keyId);
    const result = await fetchRemains(apiKey, timeoutMs, keyEntry?.endpoint);
    const vm = buildUsageViewModel(result);

    multiKeyState.updateUsageForKey(keyId, vm);

    // Update global latestVm for the selected key
    if (multiKeyState.selectedKeyId === keyId || multiKeyState.selectedKeyId === "ALL") {
      latestVm = multiKeyState.selectedKeyId === "ALL"
        ? buildAggregateVm(multiKeyState.getAggregateMetrics())
        : vm;
      latestRawResponse = result.raw;
      lastUpdatedAt = new Date();
    }

    log(`refresh key [${keyId}] [${reason}] ok=${result.ok} status=${result.statusCode ?? "N/A"}`);

    // High-risk popup: use the normalized remaining ratio only.
    if (result.ok) {
      const riskCandidate = getLowestRemainingRatioCandidate(vm);

      log(
        `quota key [${keyId}] current used=${vm.usedCount ?? "N/A"} remaining=${vm.remainingCount ?? "N/A"} total=${vm.totalCount ?? "N/A"} weekly_used=${vm.weeklyUsedCount ?? "N/A"} weekly_remaining=${vm.weeklyRemainingCount ?? "N/A"} weekly_total=${vm.weeklyTotalCount ?? "N/A"} risk_remaining=${riskCandidate?.remainingCount ?? "N/A"} risk_total=${riskCandidate?.totalCount ?? "N/A"} risk_ratio=${riskCandidate ? formatRatioForLog(riskCandidate.remainingRatio) : "N/A"} risk_window=${riskCandidate?.window ?? "N/A"}`,
      );

      if (riskCandidate && riskCandidate.remainingRatio < RISK_REMAINING_RATIO_THRESHOLD) {
        const alertKey = `${keyId}:${riskCandidate.window}`;
        const otherAlertKey = `${keyId}:${riskCandidate.window === "weekly" ? "current" : "weekly"}`;
        alertedRiskWindows.delete(otherAlertKey);

        if (!alertedRiskWindows.has(alertKey)) {
          const ratioText = formatRatioForLog(riskCandidate.remainingRatio);
          const message = strings.isEn
            ? (
              riskCandidate.window === "weekly"
                ? `MiniMax risk warning: weekly quota has only ${riskCandidate.remainingCount}/${riskCandidate.totalCount} (${ratioText}) requests left. Consider lowering request frequency or switching models.`
                : `MiniMax risk warning: current window has only ${riskCandidate.remainingCount}/${riskCandidate.totalCount} (${ratioText}) requests left. Consider lowering request frequency or switching models.`
            )
            : (
              riskCandidate.window === "weekly"
                ? `MiniMax 风险提示: 本周剩余请求次数仅 ${riskCandidate.remainingCount}/${riskCandidate.totalCount}（${ratioText}），即将耗尽！建议降低请求频率或切换模型。`
                : `MiniMax 风险提示: 当前周期剩余请求次数仅 ${riskCandidate.remainingCount}/${riskCandidate.totalCount}（${ratioText}），即将耗尽！建议降低请求频率或切换模型。`
            );
          void vscode.window.showWarningMessage(message);
          alertedRiskWindows.add(alertKey);
        }
      } else {
        alertedRiskWindows.delete(`${keyId}:current`);
        alertedRiskWindows.delete(`${keyId}:weekly`);
      }
    }

    if (!result.ok && reason === "manual") {
      void vscode.window.showErrorMessage(`${strings.errorQueryFailedPrefix}${result.summary}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : strings.errorUnknown;
    multiKeyState.updateUsageForKey(keyId, buildErrorViewModel(message));
    latestVm = buildErrorViewModel(message);
    latestRawResponse = null;
    lastUpdatedAt = new Date();
    log(`refresh key [${keyId}] exception: ${message}`);
    if (reason === "manual") {
      void vscode.window.showErrorMessage(`${strings.errorQueryExceptionPrefix}${message}`);
    }
  } finally {
    isRefreshing = false;
    updateStatusBar();
    pushUsageDataToWebview();
    if (reason === "manual") {
      for (const entry of statusItems) { entry.item.hide(); }
      setTimeout(() => { for (const entry of statusItems) { entry.item.show(); } }, 50);
    }
  }
}

// Refresh all active keys in parallel
async function refreshAllUsageData(): Promise<void> {
  if (!contextRef || isRefreshing) { return; }
  const keys = multiKeyState.activeKeys;
  if (keys.length === 0) {
    latestVm = null;
    latestRawResponse = null;
    lastUpdatedAt = null;
    updateStatusBar();
    return;
  }
  await Promise.all(keys.map(k => refreshUsageForKey(k.id, "startup")));
  // Update latestVm to reflect the selected view
  const selectedId = multiKeyState.selectedKeyId;
  if (selectedId === "ALL") {
    const agg = multiKeyState.getAggregateMetrics();
    latestVm = buildAggregateVm(agg);
  } else {
    latestVm = multiKeyState.getUsageForKey(selectedId) || null;
  }
  latestRawResponse = null;
  lastUpdatedAt = new Date();
  updateStatusBar();
  pushUsageDataToWebview();
}

// Legacy single-key refresh (redirects to currently selected key)
async function refreshUsage(reason: "startup" | "auto" | "manual"): Promise<void> {
  const selectedId = multiKeyState.selectedKeyId;
  if (selectedId === "ALL") {
    await refreshAllUsageData();
  } else {
    await refreshUsageForKey(selectedId, reason);
  }
}

function updateStatusBar(): void {
  const config = readConfig();
  const strings = getRuntimeStrings(config);
  const alignment =
    config.statusBarAlignment === "right"
      ? vscode.StatusBarAlignment.Right
      : vscode.StatusBarAlignment.Left;
  const basePriority = 100;
  const specs: StatusItemSpec[] = [];

  const keys = multiKeyState.visibleKeys;
  const activeKeys = multiKeyState.activeKeys;
  const selectedId = multiKeyState.selectedKeyId;
  const hasKeys = keys.length > 0;

  // Get current display metrics
  const agg = multiKeyState.getAggregateMetrics();
  const currentMetrics = multiKeyState.getCurrentMetrics();
  const displayVm = selectedId === "ALL"
    ? buildAggregateVm(agg)
    : (multiKeyState.getUsageForKey(selectedId) || null);

  if (isRefreshing && !displayVm) {
    const label = hasKeys
      ? `${selectCompactStateIcon("refreshing")} ${strings.statusQueryingCompact} (${activeKeys.length}🔑)`
      : `${selectCompactStateIcon("refreshing")} ${strings.statusQueryingCompact}`;
    addStatusItem(specs, alignment, basePriority, label, buildRefreshingTooltip(), "minimaxUsage.showDetails");
    renderStatusItems(specs);
    pushUsageDataToWebview();
    return;
  }

  if (!hasKeys) {
    addStatusItem(
      specs,
      alignment,
      basePriority,
      `${selectCompactStateIcon("missingKey")} ${strings.statusSetApiKeyCompact}`,
      buildMissingKeyTooltip(),
      "minimaxUsage.manageApiKeys",
      new vscode.ThemeColor("statusBarItem.warningForeground"),
      new vscode.ThemeColor("statusBarItem.warningBackground"),
    );
    renderStatusItems(specs);
    pushUsageDataToWebview();
    return;
  }

  if (!displayVm) {
    const label = `${selectCompactStateIcon("waiting")} ${activeKeys.length}🔑 ${strings.statusWaitingRefreshCompact}`;
    addStatusItem(
      specs,
      alignment,
      basePriority,
      label,
      buildWaitingTooltip(),
      "minimaxUsage.refreshAll",
      new vscode.ThemeColor("statusBarItem.prominentForeground"),
    );
    renderStatusItems(specs);
    pushUsageDataToWebview();
    return;
  }

  if (!displayVm.ok) {
    const keyLabel = selectedId === "ALL" ? `${activeKeys.length}🔑` : (multiKeyState.getKeyById(selectedId)?.name || selectedId.slice(0, 6));
    addStatusItem(
      specs,
      alignment,
      basePriority,
      `${selectCompactStateIcon("error")} ${keyLabel} ${truncate(displayVm.statusLabel, 30)}`,
      buildMultiKeyTooltip(config),
      "minimaxUsage.showDetails",
      new vscode.ThemeColor("statusBarItem.warningForeground"),
      new vscode.ThemeColor("statusBarItem.warningBackground"),
    );
    renderStatusItems(specs);
    pushUsageDataToWebview();
    return;
  }

  // Normal display - use aggregate or per-key metrics
  const usedPercent = currentMetrics.percent;
  const resetLabel = displayVm.resetTimestamp ? formatEnglishCountdownFriendly(displayVm.resetTimestamp) : "";
  const percentColor = selectCompactProgressColor(usedPercent);
  const weeklyRemainingPercent =
    displayVm.weeklyRemainingPercent !== null
      ? displayVm.weeklyRemainingPercent
      : (displayVm.weeklyUsedPercent !== null ? 100 - displayVm.weeklyUsedPercent : null);
  const weeklyPercent =
    config.showWeeklyInStatusBar && weeklyRemainingPercent !== null
      ? weeklyRemainingPercent
      : null;
  const weeklyRiskPercent =
    displayVm.weeklyUsedPercent !== null
      ? displayVm.weeklyUsedPercent
      : (weeklyRemainingPercent !== null ? 100 - weeklyRemainingPercent : null);
  const weeklyResetLabel =
    config.showWeeklyInStatusBar && displayVm.weeklyResetTimestamp
      ? formatEnglishCountdownFriendly(displayVm.weeklyResetTimestamp)
      : "";
  const statusIcon = selectCompactStatusIcon({ currentPercent: usedPercent, weeklyPercent: weeklyRiskPercent });
  const compactStatusText = buildCompactStatusText({
    icon: statusIcon,
    currentPercent: usedPercent,
    currentResetLabel: resetLabel,
    weeklyPercent,
    weeklyResetLabel,
  });

  // Key count indicator
  const keyCountTag = selectedId === "ALL"
    ? `${activeKeys.length}🔑`
    : `🔑`;

  addStatusItem(
    specs,
    alignment,
    basePriority,
    `${isRefreshing ? "$(sync~spin) " : ""}${keyCountTag} ${compactStatusText}`,
    buildMultiKeyTooltip(config),
    "minimaxUsage.showDetails",
    percentColor,
  );

  renderStatusItems(specs);
  pushUsageDataToWebview();
}

function buildRefreshingTooltip(): vscode.MarkdownString {
  const strings = getRuntimeStrings();
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${strings.tooltipTitle}**\n\n${strings.tooltipRefreshing}`);
  return md;
}

function buildWaitingTooltip(): vscode.MarkdownString {
  const strings = getRuntimeStrings();
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.appendMarkdown(`**${strings.tooltipTitle}**\n\n${strings.tooltipWaiting}`);
  md.appendMarkdown(`[$(refresh) ${strings.actionRefreshNow}](command:minimaxUsage.refresh)`);
  return md;
}

function buildMissingKeyTooltip(): vscode.MarkdownString {
  const strings = getRuntimeStrings();
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.appendMarkdown(`**${strings.tooltipTitle}**\n\n${strings.tooltipMissingKey}`);
  md.appendMarkdown(`[$(key) ${strings.actionSetApiKey}](command:minimaxUsage.manageApiKeys)`);
  return md;
}

function loadSameOriginWebviewHtml(webview: vscode.Webview): string {
  const extPath = contextRef!.extensionUri;
  const indexPath = vscode.Uri.joinPath(extPath, "src-web", "index.html");
  let html = fs.readFileSync(indexPath.fsPath, "utf-8");

  const resourceMap: Array<[string, string]> = [
    ["styles.css", "src-web/styles.css"],
    ["tauri-bridge.js", "src-web/tauri-bridge.js"],
    ["app.js", "src-web/app.js"],
  ];

  for (const [filename, relPath] of resourceMap) {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(extPath, relPath));
    html = html.replace(
      new RegExp(`(href|src)="${filename.replace(/\./g, "\\.")}"`, "g"),
      `$1="${uri.toString()}"`,
    );
  }

  const nonce = getNonce();
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, "");
  const csp = [
    `<meta http-equiv="Content-Security-Policy"`,
    `content="default-src 'none';`,
    `style-src ${webview.cspSource} 'unsafe-inline';`,
    `script-src 'nonce-${nonce}';`,
    `font-src ${webview.cspSource};`,
    `img-src ${webview.cspSource} data:;`,
    `connect-src ${webview.cspSource};">`,
  ].join(" ");
  html = html.replace("<head>", `<head>\n  ${csp}`);

  html = html.replace(/<script src="/g, `<script nonce="${nonce}" src="`);

  return html;
}

function convertUsageToAppJsFormat(u: UsageViewModel): Record<string, unknown> {
  return {
    ok: u.ok,
    status_label: u.statusLabel,
    primary_model_name: u.primaryModelName,
    time_window: u.timeWindow,
    reset_timestamp: u.resetTimestamp,
    reset_in_label: u.resetInLabel,
    total_count: u.totalCount,
    remaining_count: u.remainingCount,
    used_count: u.usedCount,
    used_percent: u.usedPercent,
    remaining_percent: u.remainingPercent,
    weekly_total_count: u.weeklyTotalCount,
    weekly_used_count: u.weeklyUsedCount,
    weekly_remaining_count: u.weeklyRemainingCount,
    weekly_used_percent: u.weeklyUsedPercent,
    weekly_remaining_percent: u.weeklyRemainingPercent,
    weekly_reset_timestamp: u.weeklyResetTimestamp,
    weekly_reset_in_label: u.weeklyResetInLabel,
    interval_label: u.intervalLabel,
    models: (u.models || []).map((m) => ({
      name: m.name,
      time_window: m.timeWindow,
      total_count: m.totalCount,
      remaining_count: m.remainingCount,
      used_count: m.usedCount,
    })),
    last_updated: lastUpdatedAt?.toLocaleString() || "",
  };
}

// Mask API key for display: show prefix + "..." + suffix
// Matches the Tauri mask_api_key logic
function maskApiKey(key: string): string {
  const len = key.length;
  if (len === 0) return "";
  if (len > 10) {
    return key.slice(0, 6) + "..." + key.slice(-4);
  }
  if (len <= 4) return "*".repeat(len);
  return key.slice(0, 2) + "..." + key.slice(-2);
}

// Build API key list with masked key values loaded from SecretStorage
async function buildKeyListWithMaskedKeys(keys: ApiKeyEntry[]): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  for (const k of keys) {
    let masked = "****";
    if (secretStore) {
      const raw = await secretStore.loadKey(k.id);
      if (raw) {
        masked = maskApiKey(raw);
      }
    }
    result.push({
      id: k.id, name: k.name, color: k.color,
      refresh_interval: k.refreshInterval,
      created_at: k.createdAt, is_active: k.isActive,
      endpoint: k.endpoint || "domestic",
      masked_key: masked,
    });
  }
  return result;
}

async function handleInvokeCommand(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const keys = multiKeyState.visibleKeys;

  switch (cmd) {
    case "cmd_get_config": {
      const config = readConfig();
      const apiKeys = await buildKeyListWithMaskedKeys(keys);
      return {
        config_version: 2,
        refresh_interval_seconds: config.refreshIntervalSeconds,
        show_weekly_in_status: config.showWeeklyInStatusBar,
        detail_model_limit: config.detailModelLimit,
        language: config.language,
        first_run: false,
        start_minimized: false,
        enable_notifications: true,
        api_keys: apiKeys,
      };
    }

    case "cmd_get_api_keys": {
      return buildKeyListWithMaskedKeys(keys);
    }

    case "cmd_get_all_usage_data": {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        const u = multiKeyState.getUsageForKey(key.id);
        if (u) result[key.id] = convertUsageToAppJsFormat(u);
      }
      return result;
    }

    case "cmd_refresh_all_usage_data": {
      await refreshAllUsageData();
      const result: Record<string, unknown> = {};
      for (const key of multiKeyState.visibleKeys) {
        const u = multiKeyState.getUsageForKey(key.id);
        if (u) {
          result[key.id] = convertUsageToAppJsFormat(u);
          detailsPanel?.webview.postMessage({
            type: "event", name: "usage-updated",
            payload: [key.id, convertUsageToAppJsFormat(u)],
          });
        }
      }
      return result;
    }

    case "cmd_save_config": {
      const config = args?.config as Record<string, unknown> | undefined;
      if (config) {
        const vs = vscode.workspace.getConfiguration("minimaxUsage");
        if (typeof config.refresh_interval_seconds === "number")
          await vs.update("refreshIntervalSeconds", config.refresh_interval_seconds, true);
        if (typeof config.language === "string")
          await vs.update("language", config.language, true);
        if (typeof config.detail_model_limit === "number")
          await vs.update("detailModelLimit", config.detail_model_limit, true);
      }
      return { ok: true };
    }

    case "cmd_add_api_key": {
      const { name, apiKey, color, refreshInterval, endpoint } = (args || {}) as {
        name: string; apiKey: string; color?: string; refreshInterval?: number; endpoint?: string;
      };
      if (!apiKey) throw new Error("API key is required");
      const v = validateApiKey(apiKey);
      if (!v.ok) throw new Error(v.message);
      const k = await addApiKey(name, apiKey, { color, refreshInterval, endpoint });
      if (!k) throw new Error("Failed to add key");
      await refreshUsageForKey(k.id, "manual");
      return { ok: true };
    }

    case "cmd_update_api_key": {
      const { id, name, color, refreshInterval, apiKey, endpoint } = (args || {}) as {
        id: string; name: string; color: string; refreshInterval: number; apiKey?: string; endpoint?: string;
      };
      const existing = multiKeyState.getKeyById(id);
      if (!existing) throw new Error("Key not found");
      const up: Record<string, unknown> = { ...existing };
      if (name) up.name = name;
      if (color) up.color = color;
      if (refreshInterval) up.refreshInterval = refreshInterval;
      if (endpoint) up.endpoint = endpoint;
      multiKeyState.addOrUpdateKey(up as unknown as ApiKeyEntry);
      if (apiKey?.trim() && secretStore) {
        const v = validateApiKey(apiKey.trim());
        if (!v.ok) throw new Error(v.message);
        await secretStore.saveKey(id, apiKey.trim());
      }
      await saveApiKeys(multiKeyState.visibleKeys);
      return { ok: true };
    }

    case "cmd_delete_api_key": {
      const id = (args as { id: string })?.id;
      if (secretStore) await secretStore.deleteKey(id);
      multiKeyState.deleteKey(id);
      await saveApiKeys(multiKeyState.visibleKeys);
      return { ok: true };
    }

    case "cmd_reorder_api_keys": {
      const ids = (args as { ids: string[] })?.ids;
      if (ids) {
        multiKeyState.reorderKeys(ids);
        await saveApiKeys(multiKeyState.visibleKeys);
      }
      return { ok: true };
    }

    case "cmd_get_autostart":
      return false;

    case "cmd_set_autostart":
      return { ok: true };

    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

function showDetailsPanel(): void {
  if (detailsPanel) {
    detailsPanel.reveal(vscode.ViewColumn.Active);
    return;
  }

  detailsPanel = vscode.window.createWebviewPanel(
    "minimaxUsage.details",
    getRuntimeStrings().detailsPanelTitle,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(contextRef!.extensionUri, "src-web"),
      ],
    },
  );

  detailsPanel.onDidDispose(() => {
    detailsPanel = undefined;
  });

  detailsPanel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.type === "invoke") {
        const { id, cmd, args } = message;
        try {
          const result = await handleInvokeCommand(cmd, args);
          detailsPanel?.webview.postMessage({
            type: "invoke_result", id, ok: true, data: result,
          });
        } catch (error) {
          detailsPanel?.webview.postMessage({
            type: "invoke_result", id, ok: false, error: String(error),
          });
        }
      }
    },
    undefined,
    contextRef?.subscriptions,
  );

  // 设置 HTML 一次；后续数据通过 postMessage 推送
  detailsPanel.webview.html = loadSameOriginWebviewHtml(detailsPanel.webview);
}

function showKeyManagementPanel(): void {
  showDetailsPanel();
  postWebviewEvent("show-key-management");
}

function postWebviewEvent(name: string, payload: unknown = null): void {
  if (!detailsPanel) return;
  const message = { type: "event", name, payload };
  for (const delayMs of [100, 300, 800]) {
    setTimeout(() => {
      void detailsPanel?.webview.postMessage(message);
    }, delayMs);
  }
}

function pushUsageDataToWebview(): void {
  if (!detailsPanel) return;
  for (const key of multiKeyState.visibleKeys) {
    const u = multiKeyState.getUsageForKey(key.id);
    if (u) {
      detailsPanel.webview.postMessage({
        type: "event",
        name: "usage-updated",
        payload: [key.id, convertUsageToAppJsFormat(u)],
      });
    }
  }
}

async function setLanguage(language: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("minimaxUsage");
  if (language === "zh-CN" || language === "en") {
    await config.update("language", language, true);
  }
}

// @ts-expect-error TS6133 - used by command-enabled HTML, cleanup pending
async function toggleLanguage(): Promise<void> {
  const config = readConfig();
  const newLang = config.language === "en" ? "zh-CN" : "en";
  await setLanguage(newLang);
}



function buildMultiKeyTooltip(config: ExtensionConfig): vscode.MarkdownString {
  const strings = getRuntimeStrings(config);
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  md.supportHtml = true;

  md.appendMarkdown(`**${strings.tooltipTitle}**\n\n`);

  const keys = multiKeyState.visibleKeys;
  const activeKeys = keys.filter(k => k.isActive);

  if (activeKeys.length === 0) {
    md.appendMarkdown(strings.tooltipMissingKey);
    md.appendMarkdown(
      `[$(key) ${strings.actionSetApiKey}](command:minimaxUsage.manageApiKeys)`,
    );
    return md;
  }

  const tooltipLabels = getCompactTooltipLabels(strings.language);
  const selectedId = multiKeyState.selectedKeyId;

  for (let i = 0; i < activeKeys.length; i++) {
    const key = activeKeys[i];
    const u = multiKeyState.getUsageForKey(key.id);

    // Separator between keys (not before first)
    if (i > 0) {
      md.appendMarkdown("\n---\n\n");
    }

    // Key name with selection indicator
    const isSelected = selectedId === key.id || selectedId === "ALL";
    const namePrefix = isSelected ? "● " : "○ ";
    md.appendMarkdown(`**${namePrefix}${escapeMarkdown(key.name)}**\n\n`);

    if (!u || !u.ok || u.usedCount === null) {
      md.appendMarkdown(`*${escapeMarkdown(u?.statusLabel || strings.unknown)}*\n\n`);
      continue;
    }

    const currentPercent = Math.round(u.usedPercent ?? 0);
    const weeklyPercent = u.weeklyRemainingPercent !== null
      ? Math.round(u.weeklyRemainingPercent)
      : (u.weeklyUsedPercent !== null ? Math.round(100 - u.weeklyUsedPercent) : null);

    const compactTable = buildCompactTooltipTable({
      currentLabel: tooltipLabels.current,
      currentUsed: u.usedCount,
      currentTotal: u.totalCount ?? 0,
      currentPercent,
      weeklyLabel: weeklyPercent !== null ? tooltipLabels.weekly : undefined,
      weeklyUsed: u.weeklyRemainingCount,
      weeklyTotal: u.weeklyTotalCount,
      weeklyPercent,
      weeklyPercentIsRemaining: true,
      barLength: 20,
    });

    md.appendMarkdown(compactTable);
  }

  md.appendMarkdown("\n\n");
  md.appendMarkdown(
    `[$(refresh) ${strings.actionRefresh}](command:minimaxUsage.refreshAll) · [$(key) ${strings.actionSetApiKey}](command:minimaxUsage.manageApiKeys)`,
  );

  return md;
}

// Build UsageViewModel from AggregateMetrics (for status bar / panel)
function buildAggregateVm(metrics: { used: number; remaining: number; total: number; percent: number; primaryModel: string; hasData: boolean }): UsageViewModel {
  return {
    ok: metrics.hasData,
    statusLabel: metrics.hasData ? "OK" : "No data",
    primaryModelName: metrics.primaryModel || "",
    minRemainingModelName: "",
    minRemainingWindow: "current" as const,
    timeWindow: "",
    resetInLabel: "",
    resetTimestamp: null,
    totalCount: metrics.total,
    remainingCount: metrics.remaining,
    minRemainingCount: null,
    usedCount: metrics.used,
    usedPercent: metrics.percent,
    remainingPercent: metrics.total > 0 ? Math.max(0, 100 - metrics.percent) : null,
    weeklyTotalCount: null,
    weeklyUsedCount: null,
    weeklyRemainingCount: null,
    weeklyUsedPercent: null,
    weeklyRemainingPercent: null,
    weeklyResetTimestamp: null,
    weeklyResetInLabel: "",
    intervalLabel: "",
    models: [],
    raw: null,
  };
}

// Load API keys from config into multiKeyState
async function loadMultiKeyState(): Promise<void> {
  const config = vscode.workspace.getConfiguration("minimaxUsage");
  const keys: ApiKeyEntry[] = config.get("apiKeys", []);
  const selectedId: string = config.get("selectedKeyId", "ALL");
  multiKeyState.setApiKeys(keys);
  multiKeyState.selectedKeyId = selectedId;
  log(`loaded ${keys.length} keys, selected=${selectedId}`);
}

// Show welcome prompt when no API keys are configured (once per extension-host session).
function showWelcomeIfNoKeys(): void {
  if (!contextRef) return;
  if (hasShownWelcomeThisSession) return;
  if (multiKeyState.visibleKeys.length > 0) return;

  hasShownWelcomeThisSession = true;
  const strings = getRuntimeStrings();

  // Defer slightly so VS Code doesn't suppress the toast during startup
  setTimeout(() => {
    vscode.window.showInformationMessage(
      strings.welcomeTitle,
      strings.welcomeConfigure,
      strings.welcomeLater,
    ).then((choice) => {
      if (choice === strings.welcomeConfigure) {
        showKeyManagementPanel();
      }
    });
  }, 500);
}

// Save API keys to config
async function saveApiKeys(keys: ApiKeyEntry[]): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration("minimaxUsage");
    await config.update("apiKeys", keys, vscode.ConfigurationTarget.Global);
  } catch (e) {
    log(`saveApiKeys config failed: ${e}`);
  }
  multiKeyState.setApiKeys(keys);
}

// Save selected key ID to config
async function setSelectedKey(keyId: string): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration("minimaxUsage");
    await config.update("selectedKeyId", keyId, vscode.ConfigurationTarget.Global);
  } catch (e) {
    log(`setSelectedKey config failed: ${e}`);
  }
  multiKeyState.selectedKeyId = keyId;
  // Update latestVm to reflect the new selection
  if (keyId === "ALL") {
    const agg = multiKeyState.getAggregateMetrics();
    latestVm = buildAggregateVm(agg);
  } else {
    latestVm = multiKeyState.getUsageForKey(keyId) || null;
  }
  updateStatusBar();
  pushUsageDataToWebview();
}

// Add a new API key
async function addApiKey(
  name: string,
  apiKey: string,
  options: { color?: string; refreshInterval?: number; endpoint?: string } = {},
): Promise<ApiKeyEntry | null> {
  if (!secretStore) return null;

  const existingKeys = multiKeyState.visibleKeys;
  const usedColors = existingKeys.map((k) => k.color);
  const palette = ["#00d4ff", "#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#1dd1a1", "#ff9f43", "#a29bfe"];
  const color = options.color || palette.find((c) => !usedColors.includes(c)) || palette[0];

  const id = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newKey: ApiKeyEntry = {
    id,
    name,
    color,
    refreshInterval: options.refreshInterval || readConfig().refreshIntervalSeconds,
    createdAt: Date.now(),
    isActive: true,
    endpoint: options.endpoint === "overseas" ? "overseas" : "domestic",
  };

  await secretStore.saveKey(id, apiKey);
  const updatedKeys = [...existingKeys, newKey];
  await saveApiKeys(updatedKeys);
  return newKey;
}

// Update an existing API key
async function updateApiKey(id: string, updates: Partial<ApiKeyEntry> & { key?: string }): Promise<boolean> {
  if (!secretStore) return false;

  const existingKey = multiKeyState.getKeyById(id);
  if (!existingKey) return false;

  const updatedKey: ApiKeyEntry = { ...existingKey, ...updates, id };
  if (updates.key) {
    await secretStore.saveKey(id, updates.key);
  }

  const existingKeys = multiKeyState.visibleKeys;
  const idx = existingKeys.findIndex((k) => k.id === id);
  if (idx < 0) return false;

  const updatedKeys = [...existingKeys];
  updatedKeys[idx] = updatedKey;
  await saveApiKeys(updatedKeys);
  return true;
}

// Delete an API key
async function deleteApiKey(id: string): Promise<void> {
  if (!secretStore) return;
  await secretStore.deleteKey(id);
  multiKeyState.deleteKey(id);
  const remaining = multiKeyState.visibleKeys;
  await saveApiKeys(remaining);
  if (multiKeyState.selectedKeyId === id) {
    await setSelectedKey(remaining.length > 0 ? remaining[0].id : "ALL");
  }
}

function validateApiKey(apiKey: string): { ok: boolean; message: string } {
  const strings = getRuntimeStrings();
  if (!apiKey) {
    return { ok: false, message: strings.validationMissingKey };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(apiKey)) {
    return { ok: false, message: strings.validationInvalidKey };
  }

  if (apiKey.length < 10) {
    return { ok: false, message: strings.validationShortKey };
  }

  return { ok: true, message: "" };
}

function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("minimaxUsage");
  const alignmentValue = config.get<string>("statusBarAlignment", "left");
  const languageValue = config.get<string>("language", "auto");

  return {
    refreshIntervalSeconds: Math.max(15, Number(config.get("refreshIntervalSeconds", 60))),
    showWeeklyInStatusBar: Boolean(config.get("showWeeklyInStatusBar", true)),
    detailModelLimit: clampNumber(Number(config.get("detailModelLimit", 8)), 1, 30),
    statusBarAlignment: alignmentValue === "right" ? "right" : "left",
    requestTimeoutMs: clampNumber(Number(config.get("requestTimeoutMs", 15000)), 3000, 60000),
    language:
      languageValue === "zh-CN" || languageValue === "en" || languageValue === "auto"
        ? languageValue
        : "auto",
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function buildCurrentQuotaRiskCandidate(
  remainingCount: number | null,
  totalCount: number | null,
  modelName: string,
): QuotaRiskCandidate | null {
  if (remainingCount === null || totalCount === null || totalCount <= 0) {
    return null;
  }

  const normalizedRemaining = Math.max(remainingCount, 0);
  return {
    remainingCount: normalizedRemaining,
    totalCount,
    remainingRatio: normalizedRemaining / totalCount,
    window: "current",
    modelName,
  };
}

function buildWeeklyQuotaRiskCandidate(
  remainingCount: number | null,
  totalCount: number | null,
  modelName: string,
  remainingPercent: number | null = null,
): QuotaRiskCandidate | null {
  if (remainingCount === null || totalCount === null || totalCount <= 0) {
    return null;
  }

  const normalizedRemaining = Math.max(remainingCount, 0);
  return {
    remainingCount: normalizedRemaining,
    totalCount,
    remainingRatio:
      remainingPercent !== null
        ? clampPercent(remainingPercent) / 100
        : normalizedRemaining / totalCount,
    window: "weekly",
    modelName,
  };
}

function pickLowestRemainingRatioCandidate(
  candidates: QuotaRiskCandidate[],
): QuotaRiskCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((lowest, candidate) => {
    if (candidate.remainingRatio < lowest.remainingRatio) {
      return candidate;
    }
    if (
      candidate.remainingRatio === lowest.remainingRatio &&
      candidate.remainingCount < lowest.remainingCount
    ) {
      return candidate;
    }
    return lowest;
  }, candidates[0]);
}

function getLowestRemainingRatioCandidate(vm: UsageViewModel): QuotaRiskCandidate | null {
  const candidates: QuotaRiskCandidate[] = [];

  for (const model of vm.models) {
    const candidate = buildCurrentQuotaRiskCandidate(
      model.remainingCount,
      model.totalCount,
      model.name,
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    const candidate = buildCurrentQuotaRiskCandidate(
      vm.remainingCount,
      vm.totalCount,
      vm.primaryModelName || vm.minRemainingModelName || "",
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const weeklyCandidate = buildWeeklyQuotaRiskCandidate(
    vm.weeklyRemainingCount,
    vm.weeklyTotalCount,
    vm.primaryModelName || vm.minRemainingModelName || "",
    vm.weeklyRemainingPercent,
  );
  if (weeklyCandidate) {
    candidates.push(weeklyCandidate);
  }

  return pickLowestRemainingRatioCandidate(candidates);
}

function formatRatioForLog(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

function buildErrorViewModel(message: string, raw: unknown = null): UsageViewModel {
  return {
    ok: false,
    statusLabel: message,
    raw,
    ...emptyUsageViewModel,
  };
}

function hasCurrentQuotaData(model: ModelRemain): boolean {
  return (model.current_interval_total_count ?? 0) > 0 ||
    (model.current_interval_usage_count ?? 0) > 0;
}

function hasWeeklyQuotaData(model: ModelRemain): boolean {
  return (model.current_weekly_total_count ?? 0) > 0 ||
    (model.current_weekly_usage_count ?? 0) > 0;
}

function selectPrimaryModel(models: ModelRemain[]): ModelRemain | undefined {
  return models.find(hasCurrentQuotaData) ??
    models.find(hasWeeklyQuotaData) ??
    models[0];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function percentFromCount(count: number | null, total: number | null): number | null {
  if (count === null || total === null || total <= 0) {
    return null;
  }
  return clampPercent((count / total) * 100);
}

function countsFromUsageField(
  total: number,
  usageCount: number,
  semantics: "used" | "remaining",
): { used: number; remaining: number } {
  if (semantics === "remaining") {
    return {
      used: Math.max(total - usageCount, 0),
      remaining: usageCount,
    };
  }

  return {
    used: usageCount,
    remaining: Math.max(total - usageCount, 0),
  };
}

function selectWeeklyRemainingPercent(models: ModelRemain[]): number | null {
  const values = models
    .map((model) => model.current_weekly_remaining_percent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map(clampPercent);

  return values.length > 0 ? Math.min(...values) : null;
}

function buildUsageViewModel(result: RemainsResult): UsageViewModel {
  const strings = getRuntimeStrings();
  const payload = (result.raw ?? null) as MiniMaxRawPayload | null;
  const models = Array.isArray(payload?.model_remains) ? payload.model_remains : [];
  const primaryModel = selectPrimaryModel(models);
  const statusLabel =
    result.summary ||
    payload?.status_msg ||
    payload?.base_resp?.status_msg ||
    strings.fetchSummaryUnknownResponse;

  if (!primaryModel) {
    return result.ok
      ? { ok: true, statusLabel, raw: result.raw, ...emptyUsageViewModel }
      : buildErrorViewModel(result.summary, result.raw);
  }

  const usageCountSemantics = result.usageCountSemantics;
  const totalCount = primaryModel.current_interval_total_count ?? 0;
  const currentCounts = countsFromUsageField(
    totalCount,
    primaryModel.current_interval_usage_count ?? 0,
    usageCountSemantics,
  );
  const usedCount = currentCounts.used;
  const remainingCount = currentCounts.remaining;
  const remainingPercent = typeof primaryModel.current_interval_remaining_percent === "number"
    ? clampPercent(primaryModel.current_interval_remaining_percent)
    : percentFromCount(remainingCount, totalCount);
  const usedPercent = remainingPercent !== null
    ? clampPercent(100 - remainingPercent)
    : (totalCount > 0 ? clampPercent((usedCount / totalCount) * 100) : 0);
  const weeklyTotalCount = primaryModel.current_weekly_total_count ?? 0;
  const weeklyCounts = countsFromUsageField(
    weeklyTotalCount,
    primaryModel.current_weekly_usage_count ?? 0,
    usageCountSemantics,
  );
  const weeklyUsedCount = weeklyCounts.used;
  const weeklyRemainingCount = weeklyCounts.remaining;
  const weeklyRemainingPercent =
    selectWeeklyRemainingPercent(models) ?? percentFromCount(weeklyRemainingCount, weeklyTotalCount);
  const weeklyUsedPercent = weeklyRemainingPercent !== null
    ? clampPercent(100 - weeklyRemainingPercent)
    : (weeklyTotalCount > 0 ? clampPercent((weeklyUsedCount / weeklyTotalCount) * 100) : null);
  const hasWeeklyQuota = weeklyTotalCount > 0 || weeklyRemainingCount > 0 || weeklyRemainingPercent !== null;
  const hasTimeWindow =
    typeof primaryModel.start_time === "number" && typeof primaryModel.end_time === "number";

  const filteredModels = models
    .filter(hasCurrentQuotaData)
    .map((model) => {
      const modelTotalCount = model.current_interval_total_count ?? 0;
      const modelCounts = countsFromUsageField(
        modelTotalCount,
        model.current_interval_usage_count ?? 0,
        usageCountSemantics,
      );
      return {
        name: model.model_name ?? strings.unknownModel,
        timeWindow:
          typeof model.start_time === "number" && typeof model.end_time === "number"
            ? `${formatTime(model.start_time)} ~ ${formatTime(model.end_time)}`
            : "",
        totalCount: modelTotalCount,
        remainingCount: modelCounts.remaining,
        usedCount: modelCounts.used,
      };
    });
  const riskSourceModels = filteredModels.length > 0
    ? filteredModels
    : [{
      name: primaryModel.model_name ?? strings.unknownModel,
      timeWindow: "",
      totalCount,
      remainingCount,
      usedCount,
    }];
  const riskSources: Array<{ name: string; remainingCount: number; window: "current" | "weekly" }> = [
    ...riskSourceModels
      .filter((model) => model.totalCount > 0)
      .map((model) => ({
        name: model.name,
        remainingCount: model.remainingCount,
        window: "current" as const,
      })),
  ];
  if (hasWeeklyQuota) {
    riskSources.push({
      name: primaryModel.model_name ?? strings.unknownModel,
      remainingCount: weeklyRemainingCount,
      window: "weekly",
    });
  }
  const minRemainingModel = riskSources.length > 0
    ? riskSources.reduce((minModel, currentModel) =>
      currentModel.remainingCount < minModel.remainingCount ? currentModel : minModel,
    riskSources[0])
    : {
      name: primaryModel.model_name ?? strings.unknownModel,
      remainingCount,
      window: "current" as const,
    };

  return {
    ok: result.ok,
    statusLabel,
    raw: result.raw,
    primaryModelName: primaryModel.model_name ?? "",
    minRemainingModelName: minRemainingModel.name,
    minRemainingWindow: minRemainingModel.window,
    timeWindow: hasTimeWindow
      ? `${formatDateTime(primaryModel.start_time as number)} ~ ${formatTime(primaryModel.end_time as number)}${strings.timeZoneSuffix}`
      : "",
    resetInLabel:
      typeof primaryModel.remains_time === "number"
        ? formatDuration(primaryModel.remains_time)
        : "",
    intervalLabel: hasTimeWindow
      ? formatEnglishDurationCompact(
          (primaryModel.end_time as number) - (primaryModel.start_time as number),
        )
      : "",
    resetTimestamp:
      typeof primaryModel.remains_time === "number"
        ? Date.now() + primaryModel.remains_time
        : null,
    totalCount,
    remainingCount,
    minRemainingCount: minRemainingModel.remainingCount,
    usedCount,
    usedPercent: Math.round(usedPercent),
    remainingPercent: remainingPercent !== null ? Math.round(remainingPercent) : null,
    weeklyTotalCount: hasWeeklyQuota ? weeklyTotalCount : null,
    weeklyUsedCount: hasWeeklyQuota ? weeklyUsedCount : null,
    weeklyRemainingCount: hasWeeklyQuota ? weeklyRemainingCount : null,
    weeklyUsedPercent: hasWeeklyQuota && weeklyUsedPercent !== null ? Math.round(weeklyUsedPercent) : null,
    weeklyRemainingPercent:
      hasWeeklyQuota && weeklyRemainingPercent !== null ? Math.round(weeklyRemainingPercent) : null,
    weeklyResetTimestamp:
      hasWeeklyQuota && typeof primaryModel.weekly_remains_time === "number"
        ? Date.now() + primaryModel.weekly_remains_time
        : null,
    weeklyResetInLabel:
      hasWeeklyQuota && typeof primaryModel.weekly_remains_time === "number"
        ? formatDuration(primaryModel.weekly_remains_time)
        : "",
    models: filteredModels,
  };
}

async function fetchRemains(apiKey: string, timeoutMs: number, endpoint?: string): Promise<RemainsResult> {
  const tokenPlanResult = await fetchRemainsFromUrl(
    apiKey,
    timeoutMs,
    getTokenPlanEndpointUrl(endpoint),
    "used",
  );
  if (tokenPlanResult.ok) {
    return tokenPlanResult;
  }

  const legacyResult = await fetchRemainsFromUrl(
    apiKey,
    timeoutMs,
    getLegacyCodingPlanEndpointUrl(endpoint),
    "remaining",
  );
  return legacyResult.ok ? legacyResult : tokenPlanResult;
}

async function fetchRemainsFromUrl(
  apiKey: string,
  timeoutMs: number,
  url: string,
  usageCountSemantics: "used" | "remaining",
): Promise<RemainsResult> {
  const strings = getRuntimeStrings();
  try {
    const { statusCode, body } = await requestJson({
      url,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs,
    });

    const payload = body as MiniMaxRawPayload;
    return summarizeRemainsPayload(payload, statusCode, usageCountSemantics);
  } catch (error) {
    const message = error instanceof Error ? error.message : strings.fetchSummaryRequestFailed;
    return {
      ok: false,
      statusCode: null,
      summary: /timeout/i.test(message) ? strings.fetchSummaryTimeout : message,
      raw: null,
      usageCountSemantics,
    };
  }
}

function requestJson(options: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      options.url,
      {
        method: "GET",
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;
          const bodyText = Buffer.concat(chunks).toString("utf8").trim();

          if (!bodyText) {
            resolve({ statusCode, body: {} });
            return;
          }

          try {
            resolve({ statusCode, body: JSON.parse(bodyText) });
          } catch {
            reject(new Error(getRuntimeStrings().invalidJsonMessage(statusCode)));
          }
        });
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("Request timeout"));
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
  });
}

function formatTime(timestamp: number): string {
  const parts = getDateTimeParts(timestamp);
  return `${parts.hour}:${parts.minute}`;
}

function formatDateTime(timestamp: number): string {
  const parts = getDateTimeParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}


function isMiniMaxRawPayload(value: unknown): value is MiniMaxRawPayload {
  return typeof value === "object" && value !== null;
}

function summarizeRemainsPayload(
  payload: MiniMaxRawPayload,
  fallbackStatusCode: number | null = null,
  usageCountSemantics: "used" | "remaining" = "used",
): RemainsResult {
  const strings = getRuntimeStrings();
  const businessStatusCode = payload.status_code ?? payload.base_resp?.status_code ?? null;
  const businessStatusMessage = payload.status_msg ?? payload.base_resp?.status_msg ?? "";

  if (businessStatusCode === 0) {
    return {
      ok: true,
      statusCode: businessStatusCode,
      summary: strings.fetchSummarySuccess,
      raw: payload,
      usageCountSemantics,
    };
  }

  if (businessStatusCode === 1004) {
    return {
      ok: false,
      statusCode: businessStatusCode,
      summary: strings.fetchSummaryCheckApiKey,
      raw: payload,
      usageCountSemantics,
    };
  }

  if ((fallbackStatusCode ?? 0) >= 400 && !businessStatusMessage) {
    return {
      ok: false,
      statusCode: fallbackStatusCode,
      summary: `HTTP ${fallbackStatusCode}`,
      raw: payload,
      usageCountSemantics,
    };
  }

  return {
    ok: false,
    statusCode: businessStatusCode ?? fallbackStatusCode,
    summary: businessStatusMessage || strings.fetchSummaryUnknownResponse,
    raw: payload,
    usageCountSemantics,
  };
}

function rebuildUsageViewModelFromRaw(raw: unknown): UsageViewModel | null {
  if (!isMiniMaxRawPayload(raw)) {
    return null;
  }

  return buildUsageViewModel(summarizeRemainsPayload(raw));
}

function getDateTimeParts(timestamp: number): Record<string, string> {
  return new Intl.DateTimeFormat(getRuntimeStrings().localeTag, {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(timestamp))
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type !== "literal") {
        accumulator[part.type] = part.value;
      }
      return accumulator;
    }, {});
}

function getNonce(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let index = 0; index < length; index += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

function log(message: string): void {
  output?.appendLine(`[${new Date().toISOString()}] ${message}`);
}
