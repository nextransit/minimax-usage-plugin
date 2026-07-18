use crate::state::{AppConfig, AppState, UsageData};
#[cfg(not(target_os = "macos"))]
use crate::tray_icon;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSBaselineOffsetAttributeName, NSFont, NSFontAttributeName, NSFontWeightRegular,
    NSKernAttributeName,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{
    NSAttributedString, NSAttributedStringKey, NSDictionary, NSNumber, NSObject, NSString,
};

#[cfg(target_os = "macos")]
fn render_m_icon() -> Image<'static> {
    const W: u32 = 18;
    const H: u32 = 18;
    let mut rgba = vec![0u8; (W * H * 4) as usize];

    const BG_R: u8 = 0;
    const BG_G: u8 = 191;
    const BG_B: u8 = 255;
    const FG_R: u8 = 255;
    const FG_G: u8 = 255;
    const FG_B: u8 = 255;

    let draw_px = |rgba: &mut [u8], x: u32, y: u32, r: u8, g: u8, b: u8| {
        if x < W && y < H {
            let idx = ((y * W + x) * 4) as usize;
            rgba[idx] = r;
            rgba[idx + 1] = g;
            rgba[idx + 2] = b;
            rgba[idx + 3] = 255;
        }
    };

    for y in 0..H {
        for x in 0..W {
            draw_px(&mut rgba, x, y, BG_R, BG_G, BG_B);
        }
    }

    for y in 2..16 {
        draw_px(&mut rgba, 3, y, FG_R, FG_G, FG_B);
        draw_px(&mut rgba, 4, y, FG_R, FG_G, FG_B);
        draw_px(&mut rgba, 13, y, FG_R, FG_G, FG_B);
        draw_px(&mut rgba, 14, y, FG_R, FG_G, FG_B);
    }
    for i in 0..6 {
        draw_px(&mut rgba, 5 + i, 2 + i, FG_R, FG_G, FG_B);
        draw_px(&mut rgba, 12 - i, 2 + i, FG_R, FG_G, FG_B);
    }

    Image::new_owned(rgba, W, H)
}

#[cfg(target_os = "macos")]
fn set_tray_title_with_color(_app: &AppHandle, tray: &TrayIcon, title: Option<&str>) {
    let Some(title) = title else {
        let _ = tray.set_title(Option::<&str>::None);
        return;
    };

    // 先走标准 title，随后用 attributedTitle 覆盖，实现更好的数字稳定与视觉对齐。
    let _ = tray.set_title(Some(title));
    set_macos_attributed_tray_title(tray, title);
}

#[cfg(target_os = "macos")]
fn set_macos_attributed_tray_title(tray: &TrayIcon, title: &str) {
    let title_string = title.to_string();
    let _ = tray.with_inner_tray_icon(move |inner| {
        let Some(status_item) = inner.ns_status_item() else {
            return;
        };
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(button) = status_item.button(mtm) else {
            return;
        };

        let font =
            unsafe { NSFont::monospacedDigitSystemFontOfSize_weight(12.0, NSFontWeightRegular) };
        let baseline = NSNumber::new_f64(-0.35);
        let kern = NSNumber::new_f64(0.15);
        let title_ns = NSString::from_str(&title_string);

        let attributed_title = unsafe {
            let keys: [&NSAttributedStringKey; 3] = [
                NSFontAttributeName,
                NSBaselineOffsetAttributeName,
                NSKernAttributeName,
            ];
            let values: [&NSObject; 3] = [font.as_ref(), baseline.as_ref(), kern.as_ref()];
            let attributes = NSDictionary::from_slices(&keys, &values);
            let attributes = attributes.cast_unchecked::<NSAttributedStringKey, AnyObject>();
            NSAttributedString::new_with_attributes(&title_ns, attributes)
        };

        button.setAttributedTitle(&attributed_title);
    });
}

#[cfg(not(target_os = "macos"))]
fn set_tray_title_with_color(_app: &AppHandle, tray: &TrayIcon, title: Option<&str>) {
    let _ = tray.set_title(title);
}

pub(crate) struct TrayI18n {
    app_name: &'static str,
    set_key_hint: &'static str,
    loading_hint: &'static str,
    quit: &'static str,
    set_key: &'static str,
    clear_key: &'static str,
    refresh: &'static str,
    show_percent_toggle: &'static str,
    check_update: &'static str,
    model_prefix: &'static str,
    interval_prefix: &'static str,
    remaining_prefix: &'static str,
    weekly_remaining_prefix: &'static str,
    updated_prefix: &'static str,
}

fn tray_i18n(language: &str) -> TrayI18n {
    if is_chinese_language(language) {
        TrayI18n {
            app_name: "MiniMax 监控",
            set_key_hint: "🔑 请设置 API Key",
            loading_hint: "⏳ 正在加载...",
            quit: "退出",
            set_key: "设置 API Key...",
            clear_key: "清除 API Key",
            refresh: "立即刷新",
            show_percent_toggle: "在托盘栏显示使用比例",
            check_update: "检查更新...",
            model_prefix: "模型",
            interval_prefix: "周期",
            remaining_prefix: "已使用",
            weekly_remaining_prefix: "本周已使用",
            updated_prefix: "更新时间",
        }
    } else {
        TrayI18n {
            app_name: "MiniMax Monitor",
            set_key_hint: "🔑 Set API Key",
            loading_hint: "⏳ Loading...",
            quit: "Quit",
            set_key: "Set API Key...",
            clear_key: "Clear API Key",
            refresh: "Refresh Now",
            show_percent_toggle: "Show Usage Percent in Tray",
            check_update: "Check for Updates...",
            model_prefix: "Model",
            interval_prefix: "Interval",
            remaining_prefix: "Used",
            weekly_remaining_prefix: "Weekly Used",
            updated_prefix: "Updated",
        }
    }
}

fn is_chinese_language(language: &str) -> bool {
    if language.eq_ignore_ascii_case("zh-CN") || language.eq_ignore_ascii_case("zh") {
        return true;
    }
    if !language.eq_ignore_ascii_case("auto") {
        return false;
    }
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|key| std::env::var(key).ok())
        .any(|locale| locale.to_ascii_lowercase().contains("zh"))
}

/// 汇总所有 API Key 的使用数据
#[derive(Debug, Clone, Default)]
pub struct SummaryUsageData {
    pub total_count: Option<i64>,
    pub remaining_count: Option<i64>,
    pub used_count: Option<i64>,
    pub used_percent: Option<f64>,
    pub weekly_total_count: Option<i64>,
    pub weekly_remaining_count: Option<i64>,
    pub weekly_used_count: Option<i64>,
    pub weekly_used_percent: Option<f64>,
    pub weekly_remaining_percent: Option<f64>,
    pub active_keys_count: usize,
    pub loaded_keys_count: usize,
    pub has_error: bool,
}

impl SummaryUsageData {
    /// 计算所有 API Key 的汇总使用数据
    ///
    /// "当前周期使用比例" = sum(各 key 已用) / sum(各 key 总额) × 100%
    /// "本周累计使用比例" = sum(各 key weekly_used × weekly_quota) / sum(各 key weekly_quota) × 100%
    ///                   若 weekly_quota 缺失则退化为简单加权平均
    pub fn from_usage_map(config: &AppConfig, usage: &HashMap<String, UsageData>) -> Self {
        let mut summary = SummaryUsageData::default();
        let mut total_count = 0i64;
        let mut remaining_count = 0i64;
        let mut used_count = 0i64;
        let mut weekly_total_count = 0i64;
        let mut weekly_remaining_count = 0i64;
        let mut weekly_used_count = 0i64;
        // weekly 加权汇总权重(各 key 的 weekly_quota_count)
        let mut weekly_weighted_used_sum = 0f64;
        let mut weekly_weight_total = 0f64;
        let mut has_any_data = false;

        // 遍历所有配置的 API Key
        for entry in &config.api_keys {
            if let Some(data) = usage.get(&entry.id) {
                summary.loaded_keys_count += 1;
                if data.ok {
                    has_any_data = true;
                    // 累计月度数据
                    if let Some(cnt) = data.total_count {
                        total_count += cnt;
                    }
                    if let Some(cnt) = data.remaining_count {
                        remaining_count += cnt;
                    }
                    if let Some(cnt) = data.used_count {
                        used_count += cnt;
                    }
                    // 累计周度数据
                    if let Some(cnt) = data.weekly_total_count {
                        weekly_total_count += cnt;
                    }
                    if let Some(cnt) = data.weekly_remaining_count {
                        weekly_remaining_count += cnt;
                    }
                    if let Some(cnt) = data.weekly_used_count {
                        weekly_used_count += cnt;
                    }
                    // weekly 比例:按每个 key 的 weekly_quota_count 加权汇总
                    let weekly_pct = data
                        .weekly_used_percent
                        .or_else(|| data.weekly_remaining_percent.map(|p| 100.0 - p));
                    if let Some(pct) = weekly_pct {
                        let weight = if entry.weekly_quota_count > 0 {
                            entry.weekly_quota_count as f64
                        } else {
                            1.0
                        };
                        weekly_weighted_used_sum += pct * weight;
                        weekly_weight_total += weight;
                    }
                } else {
                    summary.has_error = true;
                }
            }
        }

        // 计算百分比
        if total_count > 0 {
            summary.total_count = Some(total_count);
            summary.remaining_count = Some(remaining_count);
            summary.used_count = Some(used_count);
            // 加权汇总:sum(used) / sum(total)
            summary.used_percent = Some((used_count as f64 / total_count as f64) * 100.0);
        } else if has_any_data {
            // 数据没有 total/used 计数,但每个 key 仍可能报 used_percent;
            // 同样按 weekly_quota 加权汇总
            summary.used_percent = if weekly_weight_total > 0.0 {
                Some(weekly_weighted_used_sum / weekly_weight_total)
            } else {
                None
            };
        }

        if weekly_total_count > 0 {
            summary.weekly_total_count = Some(weekly_total_count);
            summary.weekly_remaining_count = Some(weekly_remaining_count);
            summary.weekly_used_count = Some(weekly_used_count);
            summary.weekly_used_percent = if weekly_weight_total > 0.0 {
                Some(weekly_weighted_used_sum / weekly_weight_total)
            } else {
                Some((weekly_used_count as f64 / weekly_total_count as f64) * 100.0)
            };
            summary.weekly_remaining_percent = summary.weekly_used_percent.map(|p| 100.0 - p);
        } else if has_any_data && weekly_weight_total > 0.0 {
            // 没有 weekly_total 计数时,使用按 weekly_quota 加权汇总后的百分比
            summary.weekly_used_percent = Some(weekly_weighted_used_sum / weekly_weight_total);
            summary.weekly_remaining_percent = summary.weekly_used_percent.map(|p| 100.0 - p);
        }

        summary.active_keys_count = config.api_keys.iter().filter(|e| e.is_active).count();

        summary
    }
}

/// 格式化汇总使用数据为托盘标题
fn format_summary_tray_usage(summary: &SummaryUsageData) -> Option<String> {
    if summary.active_keys_count == 0 {
        return None;
    }

    // 如果没有任何加载的数据，返回 key 数量
    if summary.used_percent.is_none() && summary.weekly_used_percent.is_none() {
        return Some(format!("{}🔑", summary.active_keys_count));
    }

    format_tray_usage(summary.used_percent, summary.weekly_used_percent)
}

fn format_percent(percent: Option<f64>) -> Option<String> {
    percent.map(|p| format!("{:.0}", p))
}

fn format_compact_percent(percent: Option<f64>) -> Option<String> {
    format_percent(percent).map(|p| format!("{}%", p))
}

fn format_tray_usage(current_percent: Option<f64>, weekly_percent: Option<f64>) -> Option<String> {
    match (
        format_compact_percent(current_percent),
        format_compact_percent(weekly_percent),
    ) {
        (Some(current), Some(weekly)) => Some(format!("{}/{}", current, weekly)),
        (Some(current), None) => Some(format!("{}/--%", current)),
        (None, Some(weekly)) => Some(format!("--%/{}", weekly)),
        (None, None) => None,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn build_tooltip(usage: &UsageData, i18n: &TrayI18n) -> String {
    if !usage.ok {
        return format!("{} - {}", i18n.app_name, usage.status_label);
    }
    let mut parts = vec![i18n.app_name.to_string()];
    if !usage.primary_model_name.is_empty() {
        parts.push(format!(
            "{}: {}",
            i18n.model_prefix, usage.primary_model_name
        ));
    }
    if !usage.interval_label.is_empty() {
        parts.push(format!(
            "{}: {}",
            i18n.interval_prefix, usage.interval_label
        ));
    }
    if let Some(remaining) = usage.remaining_count {
        parts.push(format!("{}: {}", i18n.remaining_prefix, remaining));
    }
    if let Some(pct) = usage.used_percent {
        parts.push(format!("Used: {:.0}%", pct));
    }
    if let Some(wk_used) = usage.weekly_used_count {
        parts.push(format!("{}: {}", i18n.weekly_remaining_prefix, wk_used));
    }
    if let Some(wk_pct) = usage.weekly_used_percent {
        parts.push(format!("Weekly Used: {:.0}%", wk_pct));
    }
    parts.join("\n")
}

#[cfg(target_os = "macos")]
fn resolve_tray_icon(_app: &tauri::App, _state: &AppState) -> Option<Image<'static>> {
    Some(render_m_icon())
}

#[cfg(not(target_os = "macos"))]
fn resolve_tray_icon(_app: &tauri::App, state: &AppState) -> Option<Image<'static>> {
    let (style, used_percent, ok) = {
        let cfg = state.config.lock().unwrap();
        let usage = state.usage_data.lock().unwrap();
        let style = cfg.tray_icon_style.clone();
        let (used_percent, ok) = if let Some(d) = usage.values().next() {
            (d.used_percent, d.ok)
        } else {
            (None, false)
        };
        (style, used_percent, ok)
    };
    Some(tray_icon::render_tray_icon(&style, used_percent, ok))
}

pub fn update_tray_menu(app: &AppHandle, state: &AppState) {
    let usage = state.usage_data.lock().unwrap();
    let config = state.config.lock().unwrap();
    let api_key = state.api_key.lock().unwrap();
    let i18n = tray_i18n(&config.language);

    let primary_usage = config
        .api_keys
        .iter()
        .find_map(|entry| usage.get(&entry.id))
        .or_else(|| usage.values().next());

    // 计算所有 API Key 的汇总数据
    let summary = SummaryUsageData::from_usage_map(&config, &usage);

    // 构建状态文本（基于汇总数据）
    let status_text = if summary.active_keys_count > 0 {
        if summary.has_error {
            format!("⚠️ {} API Key(s)", summary.active_keys_count)
        } else if summary.used_percent.is_some() || summary.weekly_remaining_percent.is_some() {
            if config.show_percent_in_tray {
                format_summary_tray_usage(&summary).unwrap_or_else(|| i18n.app_name.to_string())
            } else {
                i18n.app_name.to_string()
            }
        } else {
            i18n.loading_hint.to_string()
        }
    } else if api_key.is_none() {
        if config.show_percent_in_tray {
            i18n.set_key_hint.to_string()
        } else {
            i18n.app_name.to_string()
        }
    } else if config.show_percent_in_tray {
        i18n.loading_hint.to_string()
    } else {
        i18n.app_name.to_string()
    };

    let separator = PredefinedMenuItem::separator(app).unwrap();
    let quit = MenuItem::with_id(app, "quit", i18n.quit, true, None::<&str>).unwrap();
    let set_key = MenuItem::with_id(app, "set_key", i18n.set_key, true, None::<&str>).unwrap();
    let clear_key =
        MenuItem::with_id(app, "clear_key", i18n.clear_key, true, None::<&str>).unwrap();
    let check_update =
        MenuItem::with_id(app, "check_update", i18n.check_update, true, None::<&str>).unwrap();
    let refresh = MenuItem::with_id(app, "refresh", i18n.refresh, true, None::<&str>).unwrap();
    let toggle_show_percent = CheckMenuItem::with_id(
        app,
        "toggle_show_percent",
        i18n.show_percent_toggle,
        true,
        config.show_percent_in_tray,
        None::<&str>,
    )
    .unwrap();

    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = vec![
        Box::new(MenuItem::with_id(app, "status", &status_text, false, None::<&str>).unwrap()),
        Box::new(separator),
        Box::new(refresh),
        Box::new(toggle_show_percent),
        Box::new(set_key),
        Box::new(clear_key),
    ];

    // Insert check_update before the final quit section
    items.push(Box::new(PredefinedMenuItem::separator(app).unwrap()));
    items.push(Box::new(check_update));

    if let Some(data) = primary_usage {
        if data.ok {
            if !data.primary_model_name.is_empty() {
                let model_item = MenuItem::with_id(
                    app,
                    "model",
                    format!("{}: {}", i18n.model_prefix, data.primary_model_name),
                    false,
                    None::<&str>,
                )
                .unwrap();
                items.insert(2, Box::new(model_item));
            }

            if !data.interval_label.is_empty() {
                let interval_item = MenuItem::with_id(
                    app,
                    "interval",
                    format!("{}: {}", i18n.interval_prefix, data.interval_label),
                    false,
                    None::<&str>,
                )
                .unwrap();
                items.insert(3, Box::new(interval_item));
            }

            if let Some(used) = data.used_count {
                let remaining_item = MenuItem::with_id(
                    app,
                    "remaining",
                    format!("{}: {}", i18n.remaining_prefix, used),
                    false,
                    None::<&str>,
                )
                .unwrap();
                items.insert(4, Box::new(remaining_item));
            }

            if let Some(ref weekly_used) = data.weekly_used_count {
                let weekly_label = data
                    .weekly_used_percent
                    .map(|pct| {
                        format!(
                            "{}: {} ({:.0}%)",
                            i18n.weekly_remaining_prefix, weekly_used, pct
                        )
                    })
                    .unwrap_or_else(|| {
                        format!("{}: {}", i18n.weekly_remaining_prefix, weekly_used)
                    });
                let weekly_item =
                    MenuItem::with_id(app, "weekly_remaining", weekly_label, false, None::<&str>)
                        .unwrap();
                items.insert(5, Box::new(weekly_item));
            }

            if !data.last_updated.is_empty() {
                let sep2 = PredefinedMenuItem::separator(app).unwrap();
                let updated_item = MenuItem::with_id(
                    app,
                    "updated",
                    format!("{}: {}", i18n.updated_prefix, data.last_updated),
                    false,
                    None::<&str>,
                )
                .unwrap();
                items.push(Box::new(sep2));
                items.push(Box::new(updated_item));
            }
        } else {
            let error_item = MenuItem::with_id(
                app,
                "error",
                format!("⚠️ {}", data.status_label),
                false,
                None::<&str>,
            )
            .unwrap();
            items.insert(2, Box::new(error_item));
        }
    }

    items.push(Box::new(PredefinedMenuItem::separator(app).unwrap()));
    items.push(Box::new(quit));

    let menu =
        Menu::with_items(app, &items.iter().map(|i| i.as_ref()).collect::<Vec<_>>()).unwrap();

    if let Some(tray) = state.tray.lock().unwrap().as_ref() {
        // 使用汇总数据生成托盘标题
        let tray_title = if config.show_percent_in_tray {
            format_summary_tray_usage(&summary).unwrap_or_else(|| {
                if summary.active_keys_count > 0 {
                    format!("{}🔑", summary.active_keys_count)
                } else {
                    "MM".to_string()
                }
            })
        } else if summary.active_keys_count > 0 {
            format!("{}🔑", summary.active_keys_count)
        } else {
            "MM".to_string()
        };

        set_tray_title_with_color(app, tray, Some(&tray_title));

        // Update tooltip with rich usage details (Windows/Linux)
        #[cfg(not(target_os = "macos"))]
        if let Some(data) = primary_usage {
            let i18n2 = tray_i18n(&config.language);
            let tooltip_text = build_tooltip(data, &i18n2);
            let _ = tray.set_tooltip(Some(&tooltip_text));
        }

        // Dynamically update tray icon based on latest usage data
        #[cfg(not(target_os = "macos"))]
        {
            let icon_style = config.tray_icon_style.clone();
            let (used_percent, ok) = primary_usage
                .map(|d| (d.used_percent, d.ok))
                .unwrap_or((None, false));
            let _ = tray.set_icon(Some(tray_icon::render_tray_icon(
                &icon_style,
                used_percent,
                ok,
            )));
        }

        if let Err(e) = tray.set_menu(Some(menu)) {
            log::error!("Failed to update tray menu: {}", e);
        }
    }
}

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle().clone();
    let state: State<AppState> = app_handle.state();
    let (language, show_percent_in_tray) = {
        let cfg = state.config.lock().unwrap();
        (cfg.language.clone(), cfg.show_percent_in_tray)
    };
    let i18n = tray_i18n(&language);

    let refresh_item =
        MenuItem::with_id(&app_handle, "refresh", i18n.refresh, true, None::<&str>).unwrap();
    let toggle_item = CheckMenuItem::with_id(
        &app_handle,
        "toggle_show_percent",
        i18n.show_percent_toggle,
        true,
        show_percent_in_tray,
        None::<&str>,
    )
    .unwrap();
    let set_key_item =
        MenuItem::with_id(&app_handle, "set_key", i18n.set_key, true, None::<&str>).unwrap();
    let clear_key_item =
        MenuItem::with_id(&app_handle, "clear_key", i18n.clear_key, true, None::<&str>).unwrap();
    let check_update_item = MenuItem::with_id(
        &app_handle,
        "check_update",
        i18n.check_update,
        true,
        None::<&str>,
    )
    .unwrap();
    let quit_item = MenuItem::with_id(&app_handle, "quit", i18n.quit, true, None::<&str>).unwrap();

    let menu = Menu::with_items(
        &app_handle,
        &[
            &MenuItem::with_id(
                &app_handle,
                "status",
                i18n.loading_hint,
                false,
                None::<&str>,
            )
            .unwrap(),
            &PredefinedMenuItem::separator(&app_handle).unwrap(),
            &refresh_item,
            &toggle_item,
            &set_key_item,
            &clear_key_item,
            &PredefinedMenuItem::separator(&app_handle).unwrap(),
            &check_update_item,
            &PredefinedMenuItem::separator(&app_handle).unwrap(),
            &quit_item,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("MiniMax Monitor")
        .show_menu_on_left_click(false);

    if let Some(icon) = resolve_tray_icon(app, &state) {
        tray_builder = tray_builder.icon(icon);
    }

    #[cfg(target_os = "macos")]
    {
        // 恢复青色底 M 图标：禁用模板渲染，保持原始配色
        tray_builder = tray_builder.icon_as_template(false);
    }

    let tray_ready_at = Instant::now();

    let tray = tray_builder
        .on_menu_event(move |app, event| {
            let app_h = app.clone();
            match event.id.as_ref() {
                "quit" => {
                    app.exit(0);
                }
                "refresh" => {
                    // Multi-key refresh: iterate over all active keys
                    let keys_to_fetch: Vec<(String, String, String, i64, i64)> = {
                        let state: State<AppState> = app.state();
                        let config = state.config.lock().unwrap();
                        config
                            .api_keys
                            .iter()
                            .filter(|e| e.is_active)
                            .filter_map(|e| {
                                crate::api_key_store::load_key_for_entry(e).map(|key| {
                                    (
                                        e.id.clone(),
                                        key,
                                        e.endpoint.clone(),
                                        e.current_quota_count,
                                        e.weekly_quota_count,
                                    )
                                })
                            })
                            .collect()
                    };

                    for (key_id, api_key, endpoint, current_quota_count, weekly_quota_count) in
                        keys_to_fetch
                    {
                        let app_h_clone = app_h.clone();
                        let key_id_clone = key_id.clone();
                        tauri::async_runtime::spawn(async move {
                            match crate::api::fetch_minimax_usage(&api_key, 15000, &endpoint).await
                            {
                                Ok(mut data) => {
                                    crate::api::apply_configured_quota_counts(
                                        &mut data,
                                        current_quota_count,
                                        weekly_quota_count,
                                    );
                                    let state: State<AppState> = app_h_clone.state();
                                    {
                                        let mut usage = state.usage_data.lock().unwrap();
                                        usage.insert(key_id_clone.clone(), data.clone());
                                    }
                                    update_tray_menu(&app_h_clone, &state);
                                    // Use multi-key format: [keyId, data]
                                    let _ =
                                        app_h_clone.emit("usage-updated", (&key_id_clone, data));
                                }
                                Err(e) => {
                                    log::error!("Refresh failed for key {}: {}", key_id_clone, e);
                                    let _ = app_h_clone
                                        .emit("usage-error", (&key_id_clone, e.to_string()));
                                }
                            }
                        });
                    }
                }
                "set_key" => {
                    if tray_ready_at.elapsed() < Duration::from_millis(1500) {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        // 发送事件让前端打开 key management modal
                        let _ = window.emit("show-key-management", ());
                    }
                }
                "clear_key" => {
                    let state: State<AppState> = app.state();
                    if let Err(e) = crate::commands::cmd_clear_api_key(app.clone(), state) {
                        log::error!("Failed to clear API key from tray action: {}", e);
                    }
                }
                "check_update" => {
                    let app_h = app.clone();
                    tauri::async_runtime::spawn(async move {
                        match crate::commands::cmd_check_update(app_h.clone()).await {
                            Ok(info) => {
                                log::info!(
                                    "Manual update check: found v{}, awaiting user confirmation",
                                    info.version
                                );
                                let _ = app_h.emit(
                                    "update-available",
                                    serde_json::json!({
                                        "version": info.version,
                                        "notes": info.notes,
                                        "pub_date": info.pub_date,
                                    }),
                                );
                            }
                            Err(e) => {
                                log::info!("Manual update check: {}", e);
                            }
                        }
                    });
                }
                "toggle_show_percent" => {
                    let state: State<AppState> = app.state();
                    {
                        let mut config = state.config.lock().unwrap();
                        config.show_percent_in_tray = !config.show_percent_in_tray;
                        if let Err(e) = crate::config::save_config(&config) {
                            log::error!("Failed to save config for tray percent toggle: {}", e);
                        }
                    }
                    update_tray_menu(app, &state);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let state: State<AppState> = app.state();
                update_tray_menu(app, &state);
            }
        })
        .build(app)?;

    *state.tray.lock().unwrap() = Some(tray);
    update_tray_menu(&app_handle, &state);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::ApiKeyEntry;

    fn make_config() -> AppConfig {
        let mut config = AppConfig::default();
        config.api_keys = vec![ApiKeyEntry {
            id: "key-1".to_string(),
            name: "Test".to_string(),
            color: "#00d4ff".to_string(),
            keychain_service: "svc".to_string(),
            keychain_account: "acct".to_string(),
            refresh_interval: 20,
            current_quota_count: 1500,
            weekly_quota_count: 15000,
            created_at: 0,
            is_active: true,
            endpoint: "domestic".to_string(),
        }];
        config
    }

    fn make_usage(weekly_remaining_percent: Option<f64>) -> UsageData {
        UsageData {
            ok: true,
            status_label: "Success".to_string(),
            primary_model_name: "video".to_string(),
            time_window: String::new(),
            reset_timestamp: None,
            reset_in_label: String::new(),
            total_count: Some(3),
            remaining_count: Some(3),
            used_count: Some(0),
            used_percent: Some(0.0),
            remaining_percent: Some(100.0),
            weekly_total_count: Some(21),
            weekly_used_count: Some(0),
            weekly_remaining_count: Some(21),
            weekly_used_percent: weekly_remaining_percent.map(|pct| 100.0 - pct),
            weekly_remaining_percent,
            weekly_reset_timestamp: None,
            weekly_reset_in_label: String::new(),
            interval_label: String::new(),
            models: vec![],
            last_updated: "2026-06-01 14:00:00".to_string(),
        }
    }

    #[test]
    fn tray_summary_uses_reported_weekly_remaining_percent() {
        let config = make_config();
        let mut usage = HashMap::new();
        usage.insert("key-1".to_string(), make_usage(Some(89.0)));

        let summary = SummaryUsageData::from_usage_map(&config, &usage);

        assert_eq!(summary.weekly_remaining_percent, Some(89.0));
        assert_eq!(
            format_summary_tray_usage(&summary).as_deref(),
            Some("0%/11%")
        );
    }

    #[test]
    fn tray_summary_falls_back_to_weekly_remaining_count_ratio() {
        let config = make_config();
        let mut usage_data = make_usage(None);
        usage_data.weekly_used_count = Some(5);
        usage_data.weekly_remaining_count = Some(16);
        usage_data.weekly_used_percent = Some(5.0 / 21.0 * 100.0);
        let mut usage = HashMap::new();
        usage.insert("key-1".to_string(), usage_data);

        let summary = SummaryUsageData::from_usage_map(&config, &usage);

        assert_eq!(
            format_summary_tray_usage(&summary).as_deref(),
            Some("0%/24%")
        );
    }

    fn make_multi_key_config() -> AppConfig {
        let mut config = AppConfig::default();
        config.api_keys = vec![
            ApiKeyEntry {
                id: "key-a".to_string(),
                name: "A".to_string(),
                color: "#ff0000".to_string(),
                keychain_service: "svc-a".to_string(),
                keychain_account: "acct-a".to_string(),
                refresh_interval: 20,
                current_quota_count: 1500,
                weekly_quota_count: 15000,
                created_at: 0,
                is_active: true,
                endpoint: "domestic".to_string(),
            },
            ApiKeyEntry {
                id: "key-b".to_string(),
                name: "B".to_string(),
                color: "#00ff00".to_string(),
                keychain_service: "svc-b".to_string(),
                keychain_account: "acct-b".to_string(),
                refresh_interval: 20,
                current_quota_count: 1500,
                weekly_quota_count: 15000,
                created_at: 0,
                is_active: true,
                endpoint: "domestic".to_string(),
            },
        ];
        config
    }

    fn make_usage_with_counts(
        total: i64,
        used: i64,
        weekly_remaining_pct: Option<f64>,
    ) -> UsageData {
        let mut usage = make_usage(weekly_remaining_pct);
        usage.total_count = Some(total);
        usage.used_count = Some(used);
        usage.remaining_count = Some(total - used);
        usage.used_percent = Some((used as f64 / total as f64) * 100.0);
        usage
    }

    /// 关键 bug 复现:2 个 key,各自的 weekly_remaining_percent 让 used 比例不同
    /// A: 100% 剩余 (used 0%)  B: 30% 剩余 (used 70%)
    /// 加权汇总应该是 sum(used)/sum(total)
    #[test]
    fn tray_summary_aggregates_multiple_keys_as_weighted_average() {
        let config = make_multi_key_config();
        let mut usage = HashMap::new();
        // key-a: 周剩余 100% (即 used 0%)
        usage.insert(
            "key-a".to_string(),
            make_usage_with_counts(100, 0, Some(100.0)),
        );
        // key-b: 周剩余 30% (即 used 70%)
        usage.insert(
            "key-b".to_string(),
            make_usage_with_counts(100, 70, Some(30.0)),
        );

        let summary = SummaryUsageData::from_usage_map(&config, &usage);

        // 当前周期 used 比例: sum(used)/sum(total) = (0+70)/(100+100) = 35%
        assert_eq!(summary.used_percent, Some(35.0));
        // 本周 used 比例: 因为没有 weekly_total_count(API 不返回),
        // 取 weekly_used_percent 的加权 (sum(used*total)/sum(total)) 不可行,
        // 转为 sum(weekly_used_percent * config_weekly_quota) / sum(config_weekly_quota)
        // 即 (0%*15000 + 70%*15000)/(15000+15000) = 35%
        assert_eq!(
            summary.weekly_used_percent,
            Some(35.0),
            "weekly_used_percent must be weighted sum across all keys, not max"
        );
        assert_eq!(
            format_summary_tray_usage(&summary).as_deref(),
            Some("35%/35%")
        );
    }
}
