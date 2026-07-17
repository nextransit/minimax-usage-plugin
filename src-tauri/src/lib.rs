mod api;
pub mod api_key_store;
mod commands;
pub mod config;
mod notifications;
mod state;
mod tray;
mod tray_icon;

#[cfg(target_os = "linux")]
mod linux_fix;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

pub use commands::*;
pub use state::{ApiKeyEntry, AppConfig, AppState, ModelDetail, UsageData};

// Re-export for testing
pub use api_key_store::{delete_key_for_entry, load_key_for_entry, save_key_for_entry};
pub use config::{load_config, save_config};

// Include frontend resources directly using include_str!
// This ensures the frontend is bundled with the binary
const FRONTEND_HTML: &str = include_str!("../../src-web/index.html");
const FRONTEND_CSS: &str = include_str!("../../src-web/styles.css");
const FRONTEND_JS: &str = include_str!("../../src-web/app.js");
const API_FETCH_TIMEOUT_MS: u64 = 15_000;
const MIN_REFRESH_INTERVAL_SECONDS: u64 = 5;
const KEY_REFRESH_STAGGER_MS: u64 = 250;
const RISK_REMAINING_RATIO_THRESHOLD: f64 = 0.10;
const CLOSE_TRANSIENT_DIALOGS_JS: &str =
    "window.__MINIMAX_CLOSE_TRANSIENT_DIALOGS__ && window.__MINIMAX_CLOSE_TRANSIENT_DIALOGS__();";

#[derive(Debug, Clone, Copy)]
struct QuotaRiskCandidate {
    remaining_count: i64,
    total_count: i64,
    remaining_ratio: f64,
    window: &'static str,
}

fn build_quota_risk_candidate(
    remaining_count: Option<i64>,
    total_count: Option<i64>,
    window: &'static str,
) -> Option<QuotaRiskCandidate> {
    build_quota_risk_candidate_with_percent(remaining_count, total_count, None, window)
}

fn build_quota_risk_candidate_with_percent(
    remaining_count: Option<i64>,
    total_count: Option<i64>,
    remaining_percent: Option<f64>,
    window: &'static str,
) -> Option<QuotaRiskCandidate> {
    let remaining_count = remaining_count?;
    let total_count = total_count?;

    if total_count <= 0 {
        return None;
    }

    let normalized_remaining = remaining_count.max(0);
    Some(QuotaRiskCandidate {
        remaining_count: normalized_remaining,
        total_count,
        remaining_ratio: remaining_percent
            .filter(|percent| percent.is_finite())
            .map(|percent| percent.clamp(0.0, 100.0) / 100.0)
            .unwrap_or_else(|| normalized_remaining as f64 / total_count as f64),
        window,
    })
}

fn pick_lowest_remaining_ratio_candidate(
    candidates: Vec<QuotaRiskCandidate>,
) -> Option<QuotaRiskCandidate> {
    candidates.into_iter().reduce(|lowest, candidate| {
        if candidate.remaining_ratio < lowest.remaining_ratio
            || ((candidate.remaining_ratio - lowest.remaining_ratio).abs() < f64::EPSILON
                && candidate.remaining_count < lowest.remaining_count)
        {
            candidate
        } else {
            lowest
        }
    })
}

// Use frontend resources to prevent unused warnings
fn _use_frontend_resources() {
    println!("Frontend HTML length: {}", FRONTEND_HTML.len());
    println!("Frontend CSS length: {}", FRONTEND_CSS.len());
    println!("Frontend JS length: {}", FRONTEND_JS.len());
}

fn init_logging() {
    let mut builder =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));

    #[cfg(not(debug_assertions))]
    {
        if let Some(log_dir) = dirs::data_local_dir()
            .or_else(dirs::config_dir)
            .map(|path| path.join("minimax-usage-monitor"))
        {
            if let Err(e) = std::fs::create_dir_all(&log_dir) {
                eprintln!(
                    "Failed to create log directory {}: {}",
                    log_dir.display(),
                    e
                );
            } else if let Ok(file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_dir.join("app.log"))
            {
                builder.target(env_logger::Target::Pipe(Box::new(file)));
            }
        }
    }

    let _ = builder.try_init();
}

async fn refresh_usage_data(
    app_h: &AppHandle,
    key_id: String,
    api_key: String,
    reason: &'static str,
) {
    let guard_key = key_id.clone();
    {
        let state: tauri::State<AppState> = app_h.state();
        let mut in_flight = state.in_flight_refresh_keys.lock().unwrap();
        if !in_flight.insert(guard_key.clone()) {
            log::debug!(
                "Skip usage fetch for key {} ({}): request already in-flight",
                guard_key,
                reason
            );
            return;
        }
    }

    log::info!("Fetching usage data for key {} ({})", key_id, reason);
    let (endpoint, current_quota_count, weekly_quota_count) = {
        let state: tauri::State<AppState> = app_h.state();
        let config = state.config.lock().unwrap();
        if let Some(entry) = config.api_keys.iter().find(|e| e.id == key_id) {
            (
                entry.endpoint.clone(),
                entry.current_quota_count,
                entry.weekly_quota_count,
            )
        } else {
            (
                "domestic".to_string(),
                config.current_quota_count,
                config.weekly_quota_count,
            )
        }
    };
    let fetch_result = api::fetch_minimax_usage(&api_key, API_FETCH_TIMEOUT_MS, &endpoint)
        .await
        .map(|mut data| {
            api::apply_configured_quota_counts(&mut data, current_quota_count, weekly_quota_count);
            data
        });

    {
        let state: tauri::State<AppState> = app_h.state();
        let mut in_flight = state.in_flight_refresh_keys.lock().unwrap();
        in_flight.remove(&guard_key);
    }

    match fetch_result {
        Ok(data) => {
            let state: tauri::State<AppState> = app_h.state();
            {
                let mut usage = state.usage_data.lock().unwrap();
                usage.insert(key_id.clone(), data.clone());
            }

            log::info!(
                "Usage data refreshed for key {} ({}): ok={}, model={}, updated={}",
                key_id,
                reason,
                data.ok,
                data.primary_model_name.as_str(),
                data.last_updated.as_str()
            );
            tray::update_tray_menu(app_h, &state);
            let _ = app_h.emit("usage-updated", (&key_id, data.clone()));

            if data.ok {
                let mut risk_candidates = Vec::new();
                if !data.models.is_empty() {
                    for model in &data.models {
                        if let Some(candidate) = build_quota_risk_candidate(
                            Some(model.remaining_count),
                            Some(model.total_count),
                            "current",
                        ) {
                            risk_candidates.push(candidate);
                        }
                    }
                } else if let Some(remaining) = data.remaining_count {
                    if let Some(candidate) =
                        build_quota_risk_candidate(Some(remaining), data.total_count, "current")
                    {
                        risk_candidates.push(candidate);
                    }
                }
                if let Some(candidate) = build_quota_risk_candidate_with_percent(
                    data.weekly_remaining_count,
                    data.weekly_total_count,
                    data.weekly_remaining_percent,
                    "weekly",
                ) {
                    risk_candidates.push(candidate);
                }
                let risk_candidate = pick_lowest_remaining_ratio_candidate(risk_candidates);

                if let Some(risk) = risk_candidate {
                    log::info!(
                        "Quota risk check for key {}: window={}, remaining={}, total={}, ratio={:.2}%",
                        key_id,
                        risk.window,
                        risk.remaining_count,
                        risk.total_count,
                        risk.remaining_ratio * 100.0
                    );
                }

                if let Some(risk) = risk_candidate
                    .filter(|risk| risk.remaining_ratio < RISK_REMAINING_RATIO_THRESHOLD)
                {
                    let key_name = {
                        let config = state.config.lock().unwrap();
                        config
                            .api_keys
                            .iter()
                            .find(|e| e.id == key_id)
                            .map(|e| e.name.clone())
                            .unwrap_or_else(|| key_id.clone())
                    };
                    notifications::check_and_notify(
                        app_h,
                        &key_id,
                        &key_name,
                        risk.window,
                        risk.remaining_count,
                        risk.total_count,
                        risk.remaining_ratio,
                    );
                }
            }
        }
        Err(e) => {
            let err_msg = e.to_string();
            log::error!(
                "Usage fetch failed for key {} ({}): {}",
                key_id,
                reason,
                err_msg
            );
            let _ = app_h.emit("usage-error", (&key_id, err_msg));
        }
    }
}

fn spawn_usage_refresh_loop(app_h: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let interval_seconds = {
                let state: tauri::State<AppState> = app_h.state();
                let config = state.config.lock().unwrap();
                u64::from(config.refresh_interval_seconds).max(MIN_REFRESH_INTERVAL_SECONDS)
            };

            tokio::time::sleep(std::time::Duration::from_secs(interval_seconds)).await;

            // For multi-key: iterate over all active keys and fetch usage for each
            let keys_to_fetch: Vec<(String, String)> = {
                let state: tauri::State<AppState> = app_h.state();
                let config = state.config.lock().unwrap();
                config
                    .api_keys
                    .iter()
                    .filter(|e| e.is_active)
                    .filter_map(|e| {
                        // Load the actual API key from keychain
                        crate::api_key_store::load_key_for_entry(e).map(|key| (e.id.clone(), key))
                    })
                    .collect()
            };

            for (idx, (key_id, api_key)) in keys_to_fetch.into_iter().enumerate() {
                let app_h = app_h.clone();
                tauri::async_runtime::spawn(async move {
                    if idx > 0 {
                        let delay_ms = KEY_REFRESH_STAGGER_MS.saturating_mul(idx as u64);
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                    }
                    refresh_usage_data(&app_h, key_id, api_key, "scheduled").await;
                });
            }
        }
    });
}

pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("app-window-will-show", ());
        let _ = window.eval(CLOSE_TRANSIENT_DIALOGS_JS);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    init_logging();
    log::info!("Starting MiniMax Monitor");
    log::info!(
        "Frontend resources: HTML {} bytes, CSS {} bytes, JS {} bytes",
        FRONTEND_HTML.len(),
        FRONTEND_CSS.len(),
        FRONTEND_JS.len()
    );

    log::info!("Loading config");
    let saved_config = config::load_config().unwrap_or_default();
    log::info!(
        "Config loaded: first_run={}, start_minimized={}, show_percent_in_tray={}",
        saved_config.first_run,
        saved_config.start_minimized,
        saved_config.show_percent_in_tray
    );

    log::info!("Loading API key");
    let saved_api_key = api_key_store::load_api_key();
    log::info!("API key loaded: {}", saved_api_key.is_some());

    // Copy config values for use in closure (since we move saved_config into app_state)
    let first_run = saved_config.first_run;
    let start_minimized = saved_config.start_minimized;
    let api_key_for_fetch = saved_api_key.clone();

    let app_state = AppState {
        config: std::sync::Mutex::new(saved_config.clone()),
        api_key: std::sync::Mutex::new(saved_api_key),
        usage_data: std::sync::Mutex::new(std::collections::HashMap::new()),
        tray: std::sync::Mutex::new(None),
        in_flight_refresh_keys: std::sync::Mutex::new(std::collections::HashSet::new()),
        tray_render_cache: std::sync::Mutex::new(Default::default()),
    };

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state);

    // Single-instance 插件仅在桌面平台启用
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            log::info!("Another instance launched with args: {:?}", args);
            // 如果已有实例运行，显示主窗口
            show_main_window(app);
        }));
    }

    builder
        .setup(move |app| {
            // Setup tray icon
            log::info!("Setting up tray");
            tray::setup_tray(app)?;
            log::info!("Tray setup complete");

            // Handle window close event - hide instead of quit
            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Emit window-hidden so frontend can close all dialogs before hiding
                        let _ = window_clone.emit("window-hidden", ());
                        let _ = window_clone.eval(CLOSE_TRANSIENT_DIALOGS_JS);
                        let _ = window_clone.hide();
                        api.prevent_close();
                    }
                });
            }

            // Window visibility based on first_run and start_minimized
            if first_run {
                // First run: show window
                show_main_window(app.handle());
                // Mark first run complete
                let state: tauri::State<AppState> = app.state();
                let mut config = state.config.lock().unwrap();
                config.first_run = false;
                let _ = config::save_config(&config);
            } else if start_minimized {
                // Not first run and start_minimized: keep hidden
                log::info!("Starting minimized to tray");
            } else {
                // Not first run and not start_minimized: show window
                show_main_window(app.handle());
            }

            // Linux 特定初始化
            #[cfg(target_os = "linux")]
            {
                // 禁用 WebKitGTK 硬件加速防止白屏
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
                        let webview = webview.inner();
                        if let Some(settings) = webview.settings() {
                            SettingsExt::set_hardware_acceleration_policy(
                                &settings,
                                HardwareAccelerationPolicy::Never,
                            );
                        }
                    });

                    // 应用窗口 focus 修复
                    linux_fix::nudge_main_window(window.clone());
                }

                // 注册深链接处理器
                if linux_fix::should_register_deep_link(app) {
                    if let Err(e) = linux_fix::register_deep_link_handler(app) {
                        log::warn!("Failed to register deep link handler: {}", e);
                    }
                }
            }

            spawn_usage_refresh_loop(app_handle.clone());

            // Auto-update on startup: 检测到新版本时,emit 事件给前端,
            // 由前端弹升级对话框(展示 changelog/notes);用户点击"升级"再下载。
            {
                let update_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let Ok(updater) = update_handle.updater() else {
                        log::warn!("Auto-update: failed to init updater");
                        return;
                    };
                    match updater.check().await {
                        Ok(Some(update)) => {
                            log::info!(
                                "Auto-update: found new version v{}, awaiting user confirmation",
                                update.version
                            );
                            let _ = update_handle.emit(
                                "update-available",
                                serde_json::json!({
                                    "version": update.version,
                                    "notes": update.body,
                                    "pub_date": update.date.map(|d| d.to_string()),
                                }),
                            );
                        }
                        Ok(None) => {
                            log::info!("Auto-update: already on latest version");
                        }
                        Err(e) => {
                            log::warn!("Auto-update: check failed: {}", e);
                        }
                    }
                });
            }

            let initial_config = saved_config.clone();
            let initial_api_key = api_key_for_fetch.clone();
            tauri::async_runtime::spawn(async move {
                // Initial data fetch - support both multi-key and legacy single-key.
                // Loading credentials can touch the OS key store, so keep it off setup.
                let initial_keys: Vec<(String, String)> = if !initial_config.api_keys.is_empty() {
                    initial_config
                        .api_keys
                        .iter()
                        .filter(|e| e.is_active)
                        .filter_map(|e| {
                            api_key_store::load_key_for_entry(e).map(|key| (e.id.clone(), key))
                        })
                        .collect()
                } else if let Some(key) = initial_api_key {
                    vec![("default".to_string(), key)]
                } else {
                    vec![]
                };

                for (key_id, api_key) in initial_keys {
                    let app_h = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        refresh_usage_data(&app_h, key_id, api_key, "initial").await;
                    });
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_get_config,
            cmd_save_config,
            cmd_get_api_key,
            cmd_set_api_key,
            cmd_clear_api_key,
            cmd_fetch_usage,
            cmd_update_usage_data,
            cmd_get_autostart,
            cmd_set_autostart,
            cmd_mark_first_run_complete,
            cmd_debug_state,
            cmd_get_api_keys,
            cmd_add_api_key,
            cmd_update_api_key,
            cmd_delete_api_key,
            cmd_test_api_key,
            cmd_reorder_api_keys,
            cmd_get_usage_for_key,
            cmd_get_all_usage_data,
            cmd_refresh_all_usage_data,
            cmd_check_update,
            cmd_download_and_install_update,
            cmd_restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
