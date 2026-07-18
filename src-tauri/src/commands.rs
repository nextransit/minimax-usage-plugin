use crate::state::{ApiKeyEntry, AppConfig, AppState, UsageData};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyView {
    pub id: String,
    pub name: String,
    pub color: String,
    pub keychain_service: String,
    pub keychain_account: String,
    pub refresh_interval: u32,
    pub current_quota_count: i64,
    pub weekly_quota_count: i64,
    pub created_at: i64,
    pub is_active: bool,
    pub masked_key: Option<String>,
    pub endpoint: String,
}

fn mask_api_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    let len = chars.len();
    if len == 0 {
        return String::new();
    }
    if len > 10 {
        let prefix: String = chars.iter().take(6).collect();
        let suffix: String = chars.iter().skip(len.saturating_sub(4)).collect();
        return format!("{}...{}", prefix, suffix);
    }
    if len <= 4 {
        return "*".repeat(len);
    }
    let prefix: String = chars.iter().take(2).collect();
    let suffix: String = chars.iter().skip(len.saturating_sub(2)).collect();
    format!("{}...{}", prefix, suffix)
}

fn api_key_view(entry: ApiKeyEntry) -> ApiKeyView {
    let masked_key = crate::api_key_store::load_key_for_entry(&entry).map(|key| mask_api_key(&key));
    ApiKeyView {
        id: entry.id,
        name: entry.name,
        color: entry.color,
        keychain_service: entry.keychain_service,
        keychain_account: entry.keychain_account,
        refresh_interval: entry.refresh_interval,
        current_quota_count: entry.current_quota_count,
        weekly_quota_count: entry.weekly_quota_count,
        created_at: entry.created_at,
        is_active: entry.is_active,
        masked_key,
        endpoint: entry.endpoint.clone(),
    }
}

fn normalize_quota_count(value: Option<i64>, fallback: i64) -> i64 {
    value.unwrap_or(fallback).clamp(1, 100_000_000)
}

#[tauri::command]
pub fn cmd_debug_state(state: State<AppState>) -> String {
    let api_key = state.api_key.lock().unwrap();
    let has_key = api_key.is_some();
    let key_len = api_key.as_ref().map(|k| k.len()).unwrap_or(0);
    log::debug!(
        "cmd_debug_state called, returning: has_api_key: {}, key_length: {}",
        has_key,
        key_len
    );
    format!("has_api_key: {}, key_length: {}", has_key, key_len)
}

#[tauri::command]
pub fn cmd_get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn cmd_save_config(
    app: AppHandle,
    state: State<AppState>,
    config: AppConfig,
) -> Result<(), String> {
    {
        let mut current = state.config.lock().unwrap();
        *current = config.clone();
    }
    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    crate::tray::update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn cmd_get_api_key(state: State<AppState>) -> Option<String> {
    let key = state.api_key.lock().unwrap().clone();
    log::debug!(
        "cmd_get_api_key returning: {:?} (is_some: {})",
        key,
        key.is_some()
    );
    key
}

#[tauri::command]
pub fn cmd_set_api_key(app: AppHandle, state: State<AppState>, key: String) -> Result<(), String> {
    crate::api_key_store::save_api_key(&key)?;

    let mut api_key = state.api_key.lock().unwrap();
    *api_key = Some(key);
    drop(api_key);
    crate::tray::update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn cmd_clear_api_key(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    crate::api_key_store::clear_api_key()?;

    {
        let mut api_key = state.api_key.lock().unwrap();
        *api_key = None;
    }
    {
        let entries = state.config.lock().unwrap().api_keys.clone();
        for entry in &entries {
            crate::api_key_store::delete_key_for_entry(entry)?;
        }

        let mut config = state.config.lock().unwrap();
        config.api_keys.clear();
        crate::config::save_config(&config).map_err(|e| e.to_string())?;
    }
    {
        let mut usage = state.usage_data.lock().unwrap();
        usage.clear();
    }
    crate::tray::update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub async fn cmd_fetch_usage(
    state: State<'_, AppState>,
    api_key: String,
    timeout_ms: u64,
) -> Result<UsageData, String> {
    let (current_quota_count, weekly_quota_count) = {
        let config = state.config.lock().unwrap();
        (config.current_quota_count, config.weekly_quota_count)
    };
    crate::api::fetch_minimax_usage(&api_key, timeout_ms, "domestic")
        .await
        .map(|mut data| {
            crate::api::apply_configured_quota_counts(
                &mut data,
                current_quota_count,
                weekly_quota_count,
            );
            data
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_update_usage_data(
    app: AppHandle,
    state: State<'_, AppState>,
    key_id: String,
    data: UsageData,
) {
    {
        let mut usage = state.usage_data.lock().unwrap();
        usage.insert(key_id, data);
    }
    crate::tray::update_tray_menu(&app, &state);
}

#[tauri::command]
pub async fn cmd_get_autostart(app: AppHandle) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    autolaunch.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_mark_first_run_complete(state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.first_run = false;
    crate::config::save_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_api_keys(state: State<'_, AppState>) -> Vec<ApiKeyView> {
    state
        .config
        .lock()
        .unwrap()
        .api_keys
        .clone()
        .into_iter()
        .map(api_key_view)
        .collect()
}

#[tauri::command]
pub async fn cmd_add_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    color: String,
    api_key: String,
    refresh_interval: u32,
    current_quota_count: Option<i64>,
    weekly_quota_count: Option<i64>,
    endpoint: Option<String>,
) -> Result<ApiKeyEntry, String> {
    // Validate key first
    let ep = endpoint.clone().unwrap_or_else(|| "domestic".to_string());
    let test_result = tokio::time::timeout(
        std::time::Duration::from_secs(12),
        crate::api::fetch_minimax_usage(&api_key, 10000, &ep),
    )
    .await
    .map_err(|_| "API key validation timed out".to_string())?;
    if test_result.is_err() {
        return Err("Invalid API key: could not fetch usage data".to_string());
    }

    let (fallback_current_quota_count, fallback_weekly_quota_count) = {
        let config = state.config.lock().unwrap();
        (config.current_quota_count, config.weekly_quota_count)
    };
    let current_quota_count =
        normalize_quota_count(current_quota_count, fallback_current_quota_count);
    let weekly_quota_count = normalize_quota_count(weekly_quota_count, fallback_weekly_quota_count);

    let entry = ApiKeyEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        color,
        keychain_service: "com.decard.minimax-monitor.keys".to_string(),
        keychain_account: uuid::Uuid::new_v4().to_string(),
        refresh_interval,
        current_quota_count,
        weekly_quota_count,
        created_at: chrono::Utc::now().timestamp(),
        is_active: true,
        endpoint: ep,
    };

    // Save key to Keychain
    crate::api_key_store::save_key_for_entry(&entry, &api_key)?;

    // Add to config
    {
        let mut config = state.config.lock().unwrap();
        config.api_keys.push(entry.clone());
        crate::config::save_config(&config).map_err(|e| e.to_string())?;
    }

    // Update tray
    crate::tray::update_tray_menu(&app, &state);

    Ok(entry)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn cmd_update_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
    color: String,
    refresh_interval: u32,
    current_quota_count: Option<i64>,
    weekly_quota_count: Option<i64>,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<(), String> {
    // If updating the key itself, extract keychain info first (must borrow before lock is released)
    let keychain_update = api_key.as_ref().and_then(|new_key| {
        let config = state.config.lock().unwrap();
        config.api_keys.iter().find(|e| e.id == id).map(|e| {
            (
                e.keychain_service.clone(),
                e.keychain_account.clone(),
                new_key.clone(),
            )
        })
    });

    let mut config = state.config.lock().unwrap();
    if let Some(entry) = config.api_keys.iter_mut().find(|e| e.id == id) {
        entry.name = name;
        entry.color = color;
        entry.refresh_interval = refresh_interval;
        if let Some(value) = current_quota_count {
            entry.current_quota_count =
                normalize_quota_count(Some(value), entry.current_quota_count);
        }
        if let Some(value) = weekly_quota_count {
            entry.weekly_quota_count = normalize_quota_count(Some(value), entry.weekly_quota_count);
        }
        if let Some(ref ep) = endpoint {
            entry.endpoint = ep.clone();
        }
    }
    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    drop(config);

    // Update keychain entry if a new key was provided
    if let Some((svc, acc, key)) = keychain_update {
        let entry_for_store = crate::state::ApiKeyEntry {
            id: id.clone(),
            name: String::new(),
            color: String::new(),
            keychain_service: svc,
            keychain_account: acc,
            refresh_interval: 0,
            current_quota_count: crate::state::default_current_quota_count(),
            weekly_quota_count: crate::state::default_weekly_quota_count(),
            created_at: 0,
            is_active: false,
            endpoint: "domestic".to_string(),
        };
        crate::api_key_store::save_key_for_entry(&entry_for_store, &key)?;
    }

    crate::tray::update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn cmd_delete_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    log::info!("cmd_delete_api_key called with id: {}", id);

    let entry = {
        let config = state.config.lock().unwrap();
        log::info!("Current api_keys count: {}", config.api_keys.len());
        config.api_keys.iter().find(|e| e.id == id).cloned()
    };

    if let Some(entry) = entry {
        crate::api_key_store::delete_key_for_entry(&entry)?;

        {
            let mut config = state.config.lock().unwrap();
            config.api_keys.retain(|e| e.id != id);
            if config.api_keys.is_empty() {
                if let Err(e) = crate::api_key_store::clear_api_key() {
                    log::warn!(
                        "Failed to clear legacy API key after deleting last key: {}",
                        e
                    );
                }
            }
            crate::config::save_config(&config).map_err(|e| e.to_string())?;
        }

        {
            let mut usage = state.usage_data.lock().unwrap();
            usage.remove(&id);
        }
    }

    crate::tray::update_tray_menu(&app, &state);
    log::info!("cmd_delete_api_key completed successfully for id: {}", id);
    Ok(())
}

#[tauri::command]
pub async fn cmd_test_api_key(
    state: State<'_, AppState>,
    api_key: String,
) -> Result<UsageData, String> {
    let (current_quota_count, weekly_quota_count) = {
        let config = state.config.lock().unwrap();
        (config.current_quota_count, config.weekly_quota_count)
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(12),
        crate::api::fetch_minimax_usage(&api_key, 10000, "domestic"),
    )
    .await
    .map_err(|_| "API key test timed out".to_string())?
    .map(|mut data| {
        crate::api::apply_configured_quota_counts(
            &mut data,
            current_quota_count,
            weekly_quota_count,
        );
        data
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_reorder_api_keys(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();

    let mut new_keys = Vec::new();
    for id in ids {
        if let Some(key) = config.api_keys.iter().find(|e| e.id == id).cloned() {
            new_keys.push(key);
        }
    }
    config.api_keys = new_keys;

    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    drop(config);
    crate::tray::update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn cmd_get_usage_for_key(state: State<'_, AppState>, key_id: String) -> Option<UsageData> {
    state.usage_data.lock().unwrap().get(&key_id).cloned()
}

#[tauri::command]
pub fn cmd_get_all_usage_data(
    state: State<'_, AppState>,
) -> std::collections::HashMap<String, UsageData> {
    state.usage_data.lock().unwrap().clone()
}

#[tauri::command]
pub async fn cmd_refresh_all_usage_data(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<HashMap<String, UsageData>, String> {
    const FETCH_TIMEOUT_MS: u64 = 15_000;
    const COMMAND_TIMEOUT_MS: u64 = FETCH_TIMEOUT_MS + 2_000;

    let active_entries = {
        let config = state.config.lock().unwrap();
        config
            .api_keys
            .iter()
            .filter(|entry| entry.is_active)
            .cloned()
            .collect::<Vec<_>>()
    };

    if active_entries.is_empty() {
        let usage = state.usage_data.lock().unwrap().clone();
        return Ok(usage);
    }

    let mut tasks = Vec::new();
    let mut skipped_in_flight = 0usize;

    for entry in active_entries {
        let key_id = entry.id.clone();
        {
            let mut in_flight = state.in_flight_refresh_keys.lock().unwrap();
            if !in_flight.insert(key_id.clone()) {
                skipped_in_flight += 1;
                continue;
            }
        }

        let task_key_id = key_id.clone();
        let task = tauri::async_runtime::spawn(async move {
            let api_key = crate::api_key_store::load_key_for_entry(&entry);
            let fetch_result = match api_key {
                Some(key) => {
                    match tokio::time::timeout(
                        std::time::Duration::from_millis(COMMAND_TIMEOUT_MS),
                        crate::api::fetch_minimax_usage(&key, FETCH_TIMEOUT_MS, &entry.endpoint),
                    )
                    .await
                    {
                        Ok(result) => result
                            .map(|mut data| {
                                crate::api::apply_configured_quota_counts(
                                    &mut data,
                                    entry.current_quota_count,
                                    entry.weekly_quota_count,
                                );
                                data
                            })
                            .map_err(|e| e.to_string()),
                        Err(_) => Err("Usage fetch timed out".to_string()),
                    }
                }
                None => Err("API key not found in keychain".to_string()),
            };
            (key_id, fetch_result)
        });
        tasks.push((task_key_id, task));
    }

    if tasks.is_empty() {
        return Ok(state.usage_data.lock().unwrap().clone());
    }

    let mut changed = false;
    let mut success_count = 0usize;
    let mut failures = Vec::new();
    for (task_key_id, task) in tasks {
        let (key_id, fetch_result) = match task.await {
            Ok(result) => result,
            Err(e) => {
                let mut in_flight = state.in_flight_refresh_keys.lock().unwrap();
                in_flight.remove(&task_key_id);
                let err_msg = format!("Usage refresh task join failed: {}", e);
                log::warn!("{}", err_msg);
                failures.push((task_key_id, err_msg));
                continue;
            }
        };

        {
            let mut in_flight = state.in_flight_refresh_keys.lock().unwrap();
            in_flight.remove(&key_id);
        }

        match fetch_result {
            Ok(data) => {
                {
                    let mut usage = state.usage_data.lock().unwrap();
                    usage.insert(key_id.clone(), data.clone());
                }
                log::info!(
                    "Manual usage refresh succeeded for key {}: ok={}, model={}, updated={}",
                    key_id,
                    data.ok,
                    data.primary_model_name.as_str(),
                    data.last_updated.as_str()
                );
                let _ = app.emit("usage-updated", (&key_id, data));
                changed = true;
                success_count += 1;
            }
            Err(err_msg) => {
                log::warn!("Usage refresh failed for key {}: {}", key_id, err_msg);
                let _ = app.emit("usage-error", (&key_id, err_msg.clone()));
                failures.push((key_id, err_msg));
            }
        }
    }

    let usage = state.usage_data.lock().unwrap().clone();
    if changed {
        crate::tray::update_tray_menu(&app, &state);
    }
    if success_count == 0 && !failures.is_empty() {
        // If a scheduled refresh is already running, or we already have usable cached
        // data, do not make the Retry button look globally failed because of a stale
        // key entry with missing credentials.
        if skipped_in_flight > 0 || !usage.is_empty() {
            return Ok(usage);
        }

        let summary = failures
            .iter()
            .map(|(key_id, err)| format!("{}: {}", key_id, err))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("All usage refreshes failed: {}", summary));
    }
    Ok(usage)
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateAvailableInfo {
    pub version: String,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
}

/// 检测是否有可用更新,返回 UpdateAvailableInfo 给前端(只 check,不下载)
#[tauri::command]
pub async fn cmd_check_update(app: AppHandle) -> Result<UpdateAvailableInfo, String> {
    log::info!("Update check: requesting release metadata");
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| {
        log::warn!("Update check failed: {}", e);
        e.to_string()
    })?;
    match update {
        Some(update) => {
            log::info!("Update check: found new version v{}", update.version);
            crate::show_main_window(&app);
            Ok(UpdateAvailableInfo {
                version: update.version,
                notes: update.body,
                pub_date: update.date.map(|d| d.to_string()),
            })
        }
        None => {
            log::info!("Update check: already on latest version");
            Err("none".into())
        }
    }
}

/// 用户点击"升级"按钮:开始后台下载 + 安装;通过 progress/downloaded 事件回报状态
#[tauri::command]
pub async fn cmd_download_and_install_update(
    app: AppHandle,
    version: String,
) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        return Err("no_update".into());
    };

    if update.version != version {
        return Err(format!(
            "version mismatch: requested {} but updater has {}",
            version, update.version
        ));
    }

    let app_h = app.clone();
    let v = version.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app_h.emit(
            "update-download-started",
            serde_json::json!({ "version": v.clone() }),
        );
        let progress_app = app_h.clone();
        let v_for_closure = v.clone();
        let result = update
            .download_and_install(
                move |chunk, total| {
                    let _ = progress_app.emit(
                        "update-download-progress",
                        serde_json::json!({
                            "version": v_for_closure.clone(),
                            "chunk": chunk,
                            "total": total,
                        }),
                    );
                },
                || {},
            )
            .await;
        match result {
            Ok(_) => {
                log::info!(
                    "Auto-update: v{} downloaded, will install on next restart",
                    v
                );
                let _ = app_h.emit(
                    "update-download-finished",
                    serde_json::json!({ "version": v }),
                );
            }
            Err(e) => {
                log::warn!("Auto-update: download failed: {}", e);
                let _ = app_h.emit(
                    "update-download-failed",
                    serde_json::json!({ "version": v, "error": e.to_string() }),
                );
            }
        }
    });

    Ok(())
}

/// 下载并安装完成后,用户点"重启"按钮调用 Tauri 原生重启流程。
#[tauri::command]
pub fn cmd_restart_app(app: AppHandle) {
    log::info!("User requested restart to apply update");
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::mask_api_key;

    #[test]
    fn mask_api_key_keeps_first_6_and_last_4_for_long_keys() {
        assert_eq!(mask_api_key("abcdef1234567890wxyz"), "abcdef...wxyz");
    }

    #[test]
    fn mask_api_key_handles_short_keys_without_exposing_full_value() {
        assert_eq!(mask_api_key("abcd"), "****");
        assert_eq!(mask_api_key("abcdef"), "ab...ef");
    }
}
