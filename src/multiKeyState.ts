// Multi-key State Management for VSIX Extension

import * as vscode from 'vscode';

export interface ApiKeyEntry {
  id: string;
  name: string;
  color: string;
  refreshInterval: number;
  createdAt: number;
  isActive: boolean;
  endpoint?: string; // "domestic" (default) | "overseas"
}

export interface UsageViewModel {
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
}

export interface AggregateMetrics {
  used: number;
  remaining: number;
  total: number;
  percent: number;
  primaryModel: string;
  hasData: boolean;
  activeCount: number;
}

export class MultiKeyState {
  // API Keys configuration
  private _apiKeys: ApiKeyEntry[] = [];
  
  // Usage data per key
  private _usageData: Map<string, UsageViewModel> = new Map();
  
  // Currently selected key (or 'ALL')
  private _selectedKeyId: string = 'ALL';
  
  // Event emitter for state changes
  private _onDidChangeState = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this._onDidChangeState.event;

  get apiKeys(): ApiKeyEntry[] {
    return this._apiKeys;
  }

  get selectedKeyId(): string {
    return this._selectedKeyId;
  }

  set selectedKeyId(value: string) {
    if (this._selectedKeyId !== value) {
      this._selectedKeyId = value;
      this._onDidChangeState.fire();
    }
  }

  get usageData(): Map<string, UsageViewModel> {
    return this._usageData;
  }

  get visibleKeys(): ApiKeyEntry[] {
    return this._apiKeys;
  }

  get activeKeys(): ApiKeyEntry[] {
    return this._apiKeys.filter(k => k.isActive);
  }

  getKeyById(id: string): ApiKeyEntry | undefined {
    return this._apiKeys.find(k => k.id === id);
  }

  getUsageForKey(id: string): UsageViewModel | undefined {
    return this._usageData.get(id);
  }

  setApiKeys(keys: ApiKeyEntry[]) {
    this._apiKeys = keys;
    // Clean up usage data for deleted keys
    const keyIds = new Set(keys.map(k => k.id));
    for (const id of this._usageData.keys()) {
      if (!keyIds.has(id)) {
        this._usageData.delete(id);
      }
    }
    this._onDidChangeState.fire();
  }

  addOrUpdateKey(key: ApiKeyEntry) {
    const existing = this._apiKeys.findIndex(k => k.id === key.id);
    if (existing >= 0) {
      this._apiKeys[existing] = key;
    } else {
      this._apiKeys.push(key);
    }
    this._onDidChangeState.fire();
  }

  deleteKey(id: string) {
    this._apiKeys = this._apiKeys.filter(k => k.id !== id);
    this._usageData.delete(id);
    if (this._selectedKeyId === id) {
      this._selectedKeyId = 'ALL';
    }
    this._onDidChangeState.fire();
  }

  reorderKeys(orderedIds: string[]) {
    const keyMap = new Map(this._apiKeys.map(k => [k.id, k]));
    this._apiKeys = orderedIds
      .map(id => keyMap.get(id))
      .filter((k): k is ApiKeyEntry => k !== undefined);
    this._onDidChangeState.fire();
  }

  updateUsageForKey(id: string, data: UsageViewModel) {
    this._usageData.set(id, data);
    this._onDidChangeState.fire();
  }

  updateAllUsage(data: Map<string, UsageViewModel>) {
    this._usageData = data;
    this._onDidChangeState.fire();
  }

  getAggregateMetrics(): AggregateMetrics {
    let used = 0;
    let remaining = 0;
    let total = 0;
    let primaryModel = '';
    let hasData = false;
    let activeCount = 0;

    for (const key of this.activeKeys) {
      const data = this._usageData.get(key.id);
      if (data && data.ok) {
        hasData = true;
        activeCount++;
        
        if (data.totalCount !== null) {
          total += data.totalCount;
        }
        if (data.remainingCount !== null) {
          remaining += data.remainingCount;
        }
        if (data.usedCount !== null) {
          used += data.usedCount;
        }
        if (!primaryModel && data.primaryModelName) {
          primaryModel = data.primaryModelName;
        }
      }
    }

    const percent = total > 0 ? (used / total) * 100 : 0;

    return {
      used,
      remaining,
      total,
      percent,
      primaryModel,
      hasData,
      activeCount
    };
  }

  // Get metrics for current selection (ALL or specific key)
  getCurrentMetrics(): AggregateMetrics {
    if (this._selectedKeyId === 'ALL') {
      return this.getAggregateMetrics();
    }
    
    const key = this.getKeyById(this._selectedKeyId);
    const data = this._usageData.get(this._selectedKeyId);
    
    if (!key || !data || !data.ok) {
      return {
        used: 0,
        remaining: 0,
        total: 0,
        percent: 0,
        primaryModel: '',
        hasData: false,
        activeCount: 0
      };
    }

    return {
      used: data.usedCount ?? 0,
      remaining: data.remainingCount ?? 0,
      total: data.totalCount ?? 0,
      percent: data.usedPercent ?? 0,
      primaryModel: data.primaryModelName,
      hasData: true,
      activeCount: 1
    };
  }

  dispose() {
    this._onDidChangeState.dispose();
  }
}

// Global singleton instance
export const multiKeyState = new MultiKeyState();
