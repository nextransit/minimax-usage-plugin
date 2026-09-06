const numberFormatter = new Intl.NumberFormat("en-US");
const wideCharPattern =
  /[\u1100-\u115F\u231A-\u231B\u2329-\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2614-\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA-\u26AB\u26BD-\u26BE\u26C4-\u26C5\u26CE\u26D4\u26EA\u26F2-\u26F3\u26F5\u26FA\u26FD\u2705\u270A-\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B-\u2B1C\u2B50\u2B55\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6]/u;
const emojiPattern = /\p{Extended_Pictographic}/u;

export type CompactStatusTextInput = {
  icon: string;
  currentPercent: number;
  currentResetLabel?: string;
  weeklyPercent?: number | null;
  weeklyResetLabel?: string;
};

export type CompactTooltipLinesInput = {
  currentLabel: string;
  currentUsed: number;
  currentTotal: number;
  currentPercent: number;
  weeklyLabel?: string;
  weeklyUsed?: number | null;
  weeklyTotal?: number | null;
  weeklyPercent?: number | null;
  weeklyPercentIsRemaining?: boolean;
  barLength?: number;
};

export type CompactState = "refreshing" | "waiting" | "missingKey" | "error";

type CompactTooltipRow = {
  label: string;
  count: string;
  percent: number;
  emptyBar: string;
  filledBar: string;
  color: string;
};

export function selectCompactStatusIcon(input: {
  currentPercent?: number | null;
  weeklyPercent?: number | null;
}): string {
  const maxPercent = Math.max(
    normalizePercent(input.currentPercent),
    normalizePercent(input.weeklyPercent),
  );

  if (maxPercent >= 90) {
    return "$(error)";
  }
  if (maxPercent >= 70) {
    return "$(warning)";
  }
  return "$(zap)";
}

export function selectCompactProgressColor(percent?: number | null): string {
  const safePercent = normalizePercent(percent);

  if (safePercent >= 90) {
    return "#ff4d4f";
  }
  if (safePercent >= 70) {
    return "#faad14";
  }
  return "#52c41a";
}

export function selectCompactStateIcon(state: CompactState): string {
  switch (state) {
    case "refreshing":
      return "$(sync~spin)";
    case "waiting":
      return "$(sync)";
    case "missingKey":
      return "$(key)";
    case "error":
      return "$(error)";
  }
}

export function getCompactTooltipLabels(language: "zh-CN" | "en"): {
  current: string;
  weekly: string;
} {
  if (language === "en") {
    return {
      current: "Current:",
      weekly: "Weekly:",
    };
  }

  return {
    current: "当前周期:",
    weekly: "本周累计:",
  };
}

export function formatEnglishDurationCompact(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
}

export function formatEnglishCountdownFriendly(
  targetTimestamp: number,
  nowTimestamp: number = Date.now(),
): string {
  const diff = Math.max(targetTimestamp - nowTimestamp, 0);
  const totalSeconds = Math.ceil(diff / 1000);
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }
  return `${minutes}m`;
}

export function buildCompactStatusText(input: CompactStatusTextInput): string {
  const currentSegment = `${input.icon} ${Math.round(input.currentPercent)}%${formatStatusResetLabel(input.currentResetLabel)}`;

  if (input.weeklyPercent === null || input.weeklyPercent === undefined) {
    return currentSegment;
  }

  return `${currentSegment} · W ${Math.round(input.weeklyPercent)}%${formatStatusResetLabel(input.weeklyResetLabel)}`;
}

export function buildCompactTooltipLines(input: CompactTooltipLinesInput): string[] {
  const rows = buildCompactTooltipRows(input);

  const labelWidth = Math.max(...rows.map((row) => getDisplayWidth(row.label)));
  const countWidth = Math.max(...rows.map((row) => getDisplayWidth(row.count)));
  const percentWidth = Math.max(...rows.map((row) => getDisplayWidth(`${row.percent}%`)));

  return rows.map((row) => {
    const percentText = `${row.percent}%`;
    return `${padDisplayEnd(row.label, labelWidth)} ${padDisplayStart(row.count, countWidth)} [${row.emptyBar}${row.filledBar}] ${padDisplayStart(percentText, percentWidth)}`;
  });
}

export function buildCompactTooltipTable(input: CompactTooltipLinesInput): string {
  const rows = buildCompactTooltipRows(input);

  return [
    "<table><tbody>",
    ...rows.map((row) => {
      const percentText = `${row.percent}%`;
      return [
        "<tr>",
        `<td><code>${escapeHtml(row.label)}</code></td>`,
        `<td align="right"><code>${escapeHtml(row.count)}</code></td>`,
        `<td><code>[<span style="color:#6b7280;">${row.emptyBar}</span><span style="color:${row.color};">${row.filledBar}</span>]</code></td>`,
        `<td align="right"><code>${escapeHtml(percentText)}</code></td>`,
        "</tr>",
      ].join("");
    }),
    "</tbody></table>",
  ].join("");
}

function formatStatusResetLabel(resetLabel?: string): string {
  return resetLabel ? ` (${resetLabel})` : "";
}

function formatUsageCount(used: number, total: number): string {
  return `${numberFormatter.format(used)}/${numberFormatter.format(total)}`;
}

function buildCompactTooltipRows(input: CompactTooltipLinesInput): CompactTooltipRow[] {
  const rows: CompactTooltipRow[] = [
    createCompactTooltipRow(
      input.currentLabel,
      input.currentUsed,
      input.currentTotal,
      input.currentPercent,
      input.barLength,
    ),
  ];

  if (
    input.weeklyLabel &&
    input.weeklyUsed !== null &&
    input.weeklyUsed !== undefined &&
    input.weeklyTotal !== null &&
    input.weeklyTotal !== undefined &&
    input.weeklyPercent !== null &&
    input.weeklyPercent !== undefined
  ) {
    rows.push(
      createCompactTooltipRow(
        input.weeklyLabel,
        input.weeklyUsed,
        input.weeklyTotal,
        input.weeklyPercent,
        input.barLength,
        input.weeklyPercentIsRemaining,
      ),
    );
  }

  return rows;
}

function createCompactTooltipRow(
  label: string,
  used: number,
  total: number,
  percent: number,
  barLength: number | undefined,
  percentIsRemaining: boolean = false,
): CompactTooltipRow {
  const segments = getProgressBarSegments(percent, barLength ?? 16);
  return {
    label,
    count: formatUsageCount(used, total),
    percent,
    emptyBar: segments.empty,
    filledBar: segments.filled,
    color: percentIsRemaining ? selectRemainingProgressColor(percent) : selectCompactProgressColor(percent),
  };
}

function selectRemainingProgressColor(percent: number): string {
  const safePercent = normalizePercent(percent);

  if (safePercent <= 10) {
    return "#ff4d4f";
  }
  if (safePercent <= 30) {
    return "#faad14";
  }
  return "#52c41a";
}

function getProgressBarSegments(percent: number, length: number): { empty: string; filled: string } {
  const safePercent = Math.max(0, Math.min(100, percent));
  const filled = Math.round((safePercent / 100) * length);
  const empty = length - filled;
  return {
    empty: "░".repeat(empty),
    filled: "█".repeat(filled),
  };
}

function normalizePercent(value?: number | null): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function getDisplayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += isWideChar(char) ? 2 : 1;
  }
  return width;
}

function isWideChar(char: string): boolean {
  return emojiPattern.test(char) || wideCharPattern.test(char);
}

function padDisplayEnd(value: string, targetWidth: number): string {
  return value + " ".repeat(Math.max(0, targetWidth - getDisplayWidth(value)));
}

function padDisplayStart(value: string, targetWidth: number): string {
  return " ".repeat(Math.max(0, targetWidth - getDisplayWidth(value))) + value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
