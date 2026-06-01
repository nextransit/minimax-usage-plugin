use crate::api_key_store;
use crate::state::{ApiKeyEntry, AppConfig};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const CONFIG_DIR_ENV: &str = "MINIMAX_MONITOR_CONFIG_DIR";

fn get_config_path() -> Option<PathBuf> {
    // 首先检查环境变量覆盖
    if let Ok(dir) = std::env::var(CONFIG_DIR_ENV) {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir).join("config.json"));
        }
    }
    // 默认使用标准配置目录
    dirs::config_dir().map(|p| p.join("minimax-usage-monitor").join("config.json"))
}

// v1 config structure (before multi-api-key support)
#[derive(Debug, Clone, Deserialize)]
struct AppConfigV1 {
    #[serde(default)]
    pub config_version: u32,
    pub refresh_interval_seconds: u32,
    #[serde(default = "default_true")]
    pub show_weekly_in_status: bool,
    #[serde(default = "default_true")]
    pub show_percent_in_tray: bool,
    pub detail_model_limit: u32,
    #[serde(default = "default_current_quota_count")]
    pub current_quota_count: i64,
    #[serde(default = "default_weekly_quota_count")]
    pub weekly_quota_count: i64,
    pub language: String,
    #[serde(default = "default_true")]
    pub first_run: bool,
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default = "default_true")]
    pub enable_notifications: bool,
}

fn default_true() -> bool {
    true
}

fn default_current_quota_count() -> i64 {
    1500
}

fn default_weekly_quota_count() -> i64 {
    15000
}

pub fn load_config() -> Result<AppConfig, Box<dyn std::error::Error>> {
    let path = get_config_path().ok_or("Cannot determine config path")?;
    if !path.exists() {
        let mut config = AppConfig::default();
        if migrate_v1_to_v2(&mut config) {
            if let Err(e) = save_config(&config) {
                log::warn!("Failed to save migrated default config: {}", e);
            }
        }
        return Ok(config);
    }
    let content = fs::read_to_string(&path)?;

    // Try to deserialize as v2 first (has api_keys field)
    let config: Result<AppConfig, _> = serde_json::from_str(&content);

    match config {
        Ok(mut config) => {
            // Check if migration is needed: config_version == 0 or api_keys is empty
            if config.config_version == 0 || config.api_keys.is_empty() {
                log::info!("Migrating config from v1 to v2");
                if migrate_v1_to_v2(&mut config) {
                    if let Err(e) = save_config(&config) {
                        log::warn!("Failed to save migrated config: {}", e);
                    }
                }
            }
            return Ok(config);
        }
        Err(e) => {
            log::warn!(
                "Failed to parse v2 config ({}): {}",
                e,
                &content[..content.len().min(200)]
            );
        }
    }

    // Fallback: try to deserialize as v1 (no api_keys field)
    let v1_config: AppConfigV1 = serde_json::from_str(&content)?;
    log::info!("Loading v1 config format, will migrate to v2");

    let mut config = AppConfig {
        config_version: v1_config.config_version,
        refresh_interval_seconds: v1_config.refresh_interval_seconds,
        show_weekly_in_status: v1_config.show_weekly_in_status,
        show_percent_in_tray: v1_config.show_percent_in_tray,
        detail_model_limit: v1_config.detail_model_limit,
        current_quota_count: v1_config.current_quota_count,
        weekly_quota_count: v1_config.weekly_quota_count,
        language: v1_config.language,
        first_run: v1_config.first_run,
        start_minimized: v1_config.start_minimized,
        enable_notifications: v1_config.enable_notifications,
        tray_icon_style: "default".to_string(),
        api_keys: Vec::new(),
    };

    // Migrate v1 to v2
    if migrate_v1_to_v2(&mut config) {
        if let Err(e) = save_config(&config) {
            log::warn!("Failed to save migrated v1 config: {}", e);
        }
    }

    Ok(config)
}

fn migrate_v1_to_v2(config: &mut AppConfig) -> bool {
    let mut changed = config.config_version != 2;
    config.config_version = 2;

    if !config.api_keys.is_empty() {
        return changed;
    }

    // Try to load the old single API key from keychain (load_api_key tries primary + all legacy services)
    if let Some(api_key) = api_key_store::load_api_key() {
        if !api_key.is_empty() {
            let entry = ApiKeyEntry {
                id: Uuid::new_v4().to_string(),
                name: "Default".to_string(),
                color: "#00d4ff".to_string(), // Cyberpunk cyan
                keychain_service: "com.decard.minimax-monitor.keys".to_string(),
                keychain_account: Uuid::new_v4().to_string(),
                refresh_interval: config.refresh_interval_seconds,
                current_quota_count: config.current_quota_count,
                weekly_quota_count: config.weekly_quota_count,
                created_at: chrono::Utc::now().timestamp(),
                is_active: true,
                endpoint: "domestic".to_string(),
            };

            match api_key_store::save_key_for_entry(&entry, &api_key) {
                Ok(()) => {
                    config.api_keys.push(entry);
                    changed = true;
                    if let Err(e) = api_key_store::clear_api_key() {
                        log::warn!("Failed to clear legacy API key after migration: {}", e);
                    }
                    log::info!("Migrated old API key to new multi-key format");
                }
                Err(e) => {
                    log::warn!(
                        "Failed to copy legacy API key into multi-key storage: {}",
                        e
                    );
                }
            }
        }
    }

    changed
}

pub fn save_config(config: &AppConfig) -> Result<(), Box<dyn std::error::Error>> {
    let path = get_config_path().ok_or("Cannot determine config path")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    fs::write(&path, content)?;
    Ok(())
}
