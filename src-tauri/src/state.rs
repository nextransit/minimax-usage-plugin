use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::tray::TrayIcon as TauriTrayIcon;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub config_version: u32,
    pub refresh_interval_seconds: u32,
    pub show_weekly_in_status: bool,
    pub show_percent_in_tray: bool,
    pub detail_model_limit: u32,
    pub current_quota_count: i64,
    pub weekly_quota_count: i64,
    pub language: String,
    pub first_run: bool,
    pub start_minimized: bool,
    pub enable_notifications: bool,
    pub tray_icon_style: String,
    pub api_keys: Vec<ApiKeyEntry>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            config_version: 2,
            refresh_interval_seconds: 20,
            show_weekly_in_status: true,
            show_percent_in_tray: true,
            detail_model_limit: 8,
            current_quota_count: 1500,
            weekly_quota_count: 15000,
            language: "auto".to_string(),
            first_run: true,
            start_minimized: false,
            enable_notifications: true,
            tray_icon_style: "default".to_string(),
            api_keys: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageData {
    pub ok: bool,
    pub status_label: String,
    pub primary_model_name: String,
    pub time_window: String,
    pub reset_timestamp: Option<i64>,
    pub reset_in_label: String,
    pub total_count: Option<i64>,
    pub remaining_count: Option<i64>,
    pub used_count: Option<i64>,
    pub used_percent: Option<f64>,
    pub remaining_percent: Option<f64>,
    #[serde(default)]
    pub current_from_config: bool,
    pub weekly_total_count: Option<i64>,
    pub weekly_used_count: Option<i64>,
    pub weekly_remaining_count: Option<i64>,
    #[serde(default)]
    pub weekly_from_config: bool,
    pub weekly_used_percent: Option<f64>,
    pub weekly_remaining_percent: Option<f64>,
    pub weekly_reset_timestamp: Option<i64>,
    pub weekly_reset_in_label: String,
    pub interval_label: String,
    pub models: Vec<ModelDetail>,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDetail {
    pub name: String,
    pub time_window: String,
    pub total_count: i64,
    pub remaining_count: i64,
    pub used_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyEntry {
    pub id: String,               // UUID for internal reference
    pub name: String,             // User-defined name (e.g., "Personal")
    pub color: String,            // Hex color (e.g., "#00d4ff")
    pub keychain_service: String, // Keychain service identifier
    pub keychain_account: String, // Keychain account
    pub refresh_interval: u32,    // Seconds (min: 5, default: 20)
    #[serde(default = "default_current_quota_count")]
    pub current_quota_count: i64,
    #[serde(default = "default_weekly_quota_count")]
    pub weekly_quota_count: i64,
    pub created_at: i64, // Unix timestamp
    pub is_active: bool, // Whether this key is used
    #[serde(default = "default_endpoint")]
    pub endpoint: String, // "domestic" (default) | "overseas"
}

fn default_endpoint() -> String {
    "domestic".to_string()
}

pub fn default_current_quota_count() -> i64 {
    1500
}

pub fn default_weekly_quota_count() -> i64 {
    15000
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub api_key: Mutex<Option<String>>,
    pub usage_data: Mutex<HashMap<String, UsageData>>,
    pub tray: Mutex<Option<TauriTrayIcon>>,
    pub in_flight_refresh_keys: Mutex<HashSet<String>>,
    pub tray_render_cache: Mutex<TrayRenderCache>,
}

#[derive(Debug, Default)]
pub struct TrayRenderCache {
    pub last_title: Option<String>,
    pub last_menu_signature: Option<String>,
}
