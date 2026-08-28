use crate::state::{ModelDetail, UsageData};
use chrono::{DateTime, Local, Utc};
use serde::Deserialize;
use std::error::Error;
#[cfg(target_os = "macos")]
use std::io::Write;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
use std::time::Duration;

const CONNECT_TIMEOUT_MS: u64 = 6_000;
#[cfg(target_os = "macos")]
const CURL_FALLBACK_MAX_TIME_MS: u64 = 8_000;

#[derive(Debug, Deserialize)]
struct MiniMaxResponse {
    #[serde(rename = "base_resp")]
    base_resp: Option<BaseResp>,
    #[serde(rename = "status_code")]
    status_code: Option<i32>,
    #[serde(rename = "status_msg")]
    status_msg: Option<String>,
    #[serde(rename = "model_remains")]
    model_remains: Option<Vec<ModelRemain>>,
}

#[derive(Debug, Deserialize)]
struct BaseResp {
    #[serde(rename = "status_code")]
    status_code: Option<i32>,
    #[serde(rename = "status_msg")]
    status_msg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelRemain {
    #[serde(rename = "start_time")]
    start_time: Option<i64>,
    #[serde(rename = "end_time")]
    end_time: Option<i64>,
    #[serde(rename = "remains_time")]
    remains_time: Option<i64>,
    #[serde(rename = "current_interval_total_count", alias = "current_total")]
    current_interval_total_count: Option<i64>,
    #[serde(rename = "current_interval_usage_count", alias = "current_usage")]
    current_interval_usage_count: Option<i64>,
    #[serde(
        rename = "current_interval_remaining_percent",
        alias = "current_remaining_percent"
    )]
    current_interval_remaining_percent: Option<f64>,
    #[serde(rename = "model_name")]
    model_name: Option<String>,
    #[serde(rename = "current_weekly_total_count", alias = "weekly_total")]
    current_weekly_total_count: Option<i64>,
    #[serde(rename = "current_weekly_usage_count", alias = "weekly_usage")]
    current_weekly_usage_count: Option<i64>,
    #[serde(
        rename = "current_weekly_remaining_percent",
        alias = "weekly_remaining_percent"
    )]
    current_weekly_remaining_percent: Option<f64>,
    #[serde(rename = "weekly_remains_time")]
    weekly_remains_time: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UsageCountSemantics {
    Used,
    Remaining,
}

fn resolve_endpoint_base(endpoint: &str) -> &'static str {
    match endpoint {
        "overseas" => "https://www.minimax.io",
        _ => "https://www.minimaxi.com",
    }
}

fn resolve_token_plan_endpoint(endpoint: &str) -> String {
    format!("{}/v1/token_plan/remains", resolve_endpoint_base(endpoint))
}

fn resolve_legacy_coding_plan_endpoint(endpoint: &str) -> String {
    let base = match endpoint {
        "overseas" => "https://platform.minimax.io",
        _ => "https://www.minimaxi.com",
    };
    format!("{}/v1/api/openplatform/coding_plan/remains", base)
}

pub async fn fetch_minimax_usage(
    api_key: &str,
    timeout_ms: u64,
    endpoint: &str,
) -> Result<UsageData, Box<dyn std::error::Error + Send + Sync>> {
    let api_key = api_key.to_string();
    let token_plan_url = resolve_token_plan_endpoint(endpoint);
    let legacy_url = resolve_legacy_coding_plan_endpoint(endpoint);
    let (payload, semantics) = tokio::task::spawn_blocking(move || {
        fetch_minimax_payload_blocking_with_compat(
            &api_key,
            timeout_ms,
            &token_plan_url,
            &legacy_url,
        )
    })
    .await
    .map_err(|e| format!("MiniMax request task failed: {}", e))??;

    Ok(build_usage_data_from_payload(
        payload,
        Local::now(),
        semantics,
    ))
}

fn build_usage_data_from_payload(
    mut payload: MiniMaxResponse,
    now: DateTime<Local>,
    semantics: UsageCountSemantics,
) -> UsageData {
    let business_status_code = business_status_code(&payload).unwrap_or(0);

    if business_status_code != 0 {
        let msg = payload
            .status_msg
            .or(payload.base_resp.and_then(|b| b.status_msg))
            .unwrap_or_else(|| "Unknown error".to_string());
        return UsageData {
            ok: false,
            status_label: msg,
            primary_model_name: String::new(),
            time_window: String::new(),
            reset_timestamp: None,
            reset_in_label: String::new(),
            total_count: None,
            remaining_count: None,
            used_count: None,
            used_percent: None,
            remaining_percent: None,
            current_from_config: false,
            weekly_total_count: None,
            weekly_used_count: None,
            weekly_remaining_count: None,
            weekly_from_config: false,
            weekly_used_percent: None,
            weekly_remaining_percent: None,
            weekly_reset_timestamp: None,
            weekly_reset_in_label: String::new(),
            interval_label: String::new(),
            models: vec![],
            last_updated: now.format("%Y-%m-%d %H:%M:%S").to_string(),
        };
    }

    let models = payload.model_remains.take().unwrap_or_default();
    let primary = select_primary_model(&models);

    let (total_count, remaining_count, used_count, current_used_percent_from_counts) =
        if let Some(m) = primary {
            let (total, used, remaining) = current_counts(m, semantics);
            let percent = used_percent_from_counts(total, used);
            (Some(total), Some(remaining), Some(used), Some(percent))
        } else {
            (None, None, None, None)
        };

    let remaining_percent = primary.and_then(|m| {
        m.current_interval_remaining_percent
            .map(clamp_percent)
            .or_else(|| percent_from_count_pair(remaining_count, total_count))
    });
    let used_percent = remaining_percent
        .map(|remaining| clamp_percent(100.0 - remaining))
        .or(current_used_percent_from_counts);

    let (weekly_total, weekly_remaining, weekly_used, weekly_percent) = if let Some(m) = primary {
        let (total, used, remaining) = weekly_counts(m, semantics);
        let percent = used_percent_from_counts(total, used);
        (Some(total), Some(remaining), Some(used), Some(percent))
    } else {
        (None, None, None, None)
    };

    let weekly_remaining_percent = primary
        .and_then(|m| m.current_weekly_remaining_percent.map(clamp_percent))
        .or_else(|| select_weekly_remaining_percent(&models))
        .or_else(|| percent_from_count_pair(weekly_remaining, weekly_total));
    let weekly_percent = weekly_remaining_percent
        .map(|remaining| clamp_percent(100.0 - remaining))
        .or(weekly_percent);

    let (reset_timestamp, reset_in_label) = if let Some(m) = primary {
        if let Some(rt) = m.remains_time {
            let target = now + chrono::Duration::milliseconds(rt);
            let duration = target.signed_duration_since(now);
            let label = format_duration(duration.num_seconds());
            (Some(target.timestamp_millis()), label)
        } else {
            (None, String::new())
        }
    } else {
        (None, String::new())
    };

    let (weekly_reset_timestamp, weekly_reset_in_label) = if let Some(m) = primary {
        if let Some(rt) = m.weekly_remains_time {
            let target = now + chrono::Duration::milliseconds(rt);
            let duration = target.signed_duration_since(now);
            let label = format_duration(duration.num_seconds());
            (Some(target.timestamp_millis()), label)
        } else {
            (None, String::new())
        }
    } else {
        (None, String::new())
    };

    let (time_window, interval_label) = if let Some(m) = primary {
        let start = m.start_time.unwrap_or(0);
        let end = m.end_time.unwrap_or(0);
        if start > 0 && end > 0 {
            let start_dt = DateTime::from_timestamp(start / 1000, 0)
                .unwrap_or_else(|| Utc::now().with_timezone(&Utc));
            let end_dt = DateTime::from_timestamp(end / 1000, 0)
                .unwrap_or_else(|| Utc::now().with_timezone(&Utc));
            let window = format!("{} ~ {}", start_dt.format("%H:%M"), end_dt.format("%H:%M"));
            let duration = end_dt.signed_duration_since(start_dt);
            let interval = format_english_duration(duration.num_seconds());
            (format!("{} (UTC+8)", window), interval)
        } else {
            (String::new(), String::new())
        }
    } else {
        (String::new(), String::new())
    };

    let model_details: Vec<ModelDetail> = models
        .iter()
        .filter(|m| has_current_quota_data(m))
        .map(|m| {
            let (total, used, remaining) = current_counts(m, semantics);
            let (time_window, _) = match (m.start_time, m.end_time) {
                (Some(start), Some(end)) => {
                    let start_dt = DateTime::from_timestamp(start / 1000, 0)
                        .unwrap_or_else(|| Utc::now().with_timezone(&Utc));
                    let end_dt = DateTime::from_timestamp(end / 1000, 0)
                        .unwrap_or_else(|| Utc::now().with_timezone(&Utc));
                    (
                        format!("{} ~ {}", start_dt.format("%H:%M"), end_dt.format("%H:%M")),
                        (),
                    )
                }
                _ => ("00:00 ~ 00:00".to_string(), ()),
            };
            ModelDetail {
                name: m
                    .model_name
                    .clone()
                    .unwrap_or_else(|| "Unknown".to_string()),
                time_window,
                total_count: total,
                remaining_count: remaining,
                used_count: used,
            }
        })
        .collect();

    UsageData {
        ok: true,
        status_label: "Success".to_string(),
        primary_model_name: primary
            .and_then(|m| m.model_name.clone())
            .unwrap_or_default(),
        time_window,
        reset_timestamp,
        reset_in_label,
        total_count,
        remaining_count,
        used_count,
        used_percent,
        remaining_percent,
        current_from_config: false,
        weekly_total_count: weekly_total.filter(|&v| v > 0),
        weekly_used_count: weekly_used,
        weekly_remaining_count: weekly_remaining,
        weekly_from_config: false,
        weekly_used_percent: weekly_percent.filter(|&v| v.is_finite()),
        weekly_remaining_percent,
        weekly_reset_timestamp,
        weekly_reset_in_label,
        interval_label,
        models: model_details,
        last_updated: now.format("%Y-%m-%d %H:%M:%S").to_string(),
    }
}

pub fn apply_configured_quota_counts(
    data: &mut UsageData,
    current_quota_count: i64,
    weekly_quota_count: i64,
) {
    if !data.ok {
        return;
    }

    if data.total_count.unwrap_or(0) <= 0 {
        if let Some(remaining_percent) = data.remaining_percent {
            let (total, remaining, used) =
                counts_from_remaining_percent(current_quota_count, remaining_percent);
            data.total_count = Some(total);
            data.remaining_count = Some(remaining);
            data.used_count = Some(used);
            data.used_percent = Some(clamp_percent(100.0 - remaining_percent));
            data.current_from_config = true;
            log::info!(
                "[quota] 当前周期由配置反推 (无真实 API 计数): key={} current_quota={} remaining_percent={:.1} => total={} remaining={} used={}",
                data.primary_model_name,
                current_quota_count,
                remaining_percent,
                total,
                remaining,
                used,
            );
        }
    }

    if data.weekly_total_count.unwrap_or(0) <= 0 {
        if let Some(remaining_percent) = data.weekly_remaining_percent {
            let (total, remaining, used) =
                counts_from_remaining_percent(weekly_quota_count, remaining_percent);
            data.weekly_total_count = Some(total);
            data.weekly_remaining_count = Some(remaining);
            data.weekly_used_count = Some(used);
            data.weekly_used_percent = Some(clamp_percent(100.0 - remaining_percent));
            data.weekly_from_config = true;
            log::info!(
                "[quota] 本周累计由配置反推 (无真实 API 计数): key={} weekly_quota={} remaining_percent={:.1} => total={} remaining={} used={}",
                data.primary_model_name,
                weekly_quota_count,
                remaining_percent,
                total,
                remaining,
                used,
            );
        }
    }
}

fn counts_from_remaining_percent(total: i64, remaining_percent: f64) -> (i64, i64, i64) {
    let total = total.max(0);
    let remaining = ((total as f64) * clamp_percent(remaining_percent) / 100.0).round() as i64;
    let remaining = remaining.clamp(0, total);
    (total, remaining, total.saturating_sub(remaining))
}

fn select_primary_model(models: &[ModelRemain]) -> Option<&ModelRemain> {
    models
        .iter()
        .find(|m| is_general_model(m))
        .or_else(|| models.iter().find(|m| has_current_quota_data(m)))
        .or_else(|| models.iter().find(|m| has_weekly_quota_data(m)))
        .or_else(|| models.first())
}

fn is_general_model(model: &ModelRemain) -> bool {
    matches!(
        model.model_name.as_deref(),
        Some(name) if name.eq_ignore_ascii_case("general")
    )
}

fn has_current_quota_data(model: &ModelRemain) -> bool {
    model.current_interval_total_count.unwrap_or(0) > 0
        || model.current_interval_usage_count.unwrap_or(0) > 0
}

fn has_weekly_quota_data(model: &ModelRemain) -> bool {
    model.current_weekly_total_count.unwrap_or(0) > 0
        || model.current_weekly_usage_count.unwrap_or(0) > 0
}

fn current_counts(model: &ModelRemain, semantics: UsageCountSemantics) -> (i64, i64, i64) {
    usage_counts(
        model.current_interval_total_count.unwrap_or(0),
        model.current_interval_usage_count.unwrap_or(0),
        semantics,
    )
}

fn weekly_counts(model: &ModelRemain, semantics: UsageCountSemantics) -> (i64, i64, i64) {
    usage_counts(
        model.current_weekly_total_count.unwrap_or(0),
        model.current_weekly_usage_count.unwrap_or(0),
        semantics,
    )
}

fn usage_counts(total: i64, usage_count: i64, semantics: UsageCountSemantics) -> (i64, i64, i64) {
    match semantics {
        UsageCountSemantics::Used => (total, usage_count, total.saturating_sub(usage_count)),
        UsageCountSemantics::Remaining => (total, total.saturating_sub(usage_count), usage_count),
    }
}

fn used_percent_from_counts(total: i64, used: i64) -> f64 {
    if total > 0 {
        (used as f64 / total as f64) * 100.0
    } else {
        0.0
    }
}

fn percent_from_count_pair(count: Option<i64>, total: Option<i64>) -> Option<f64> {
    match (count, total) {
        (Some(count), Some(total)) if total > 0 => {
            Some(clamp_percent((count as f64 / total as f64) * 100.0))
        }
        _ => None,
    }
}

fn clamp_percent(percent: f64) -> f64 {
    if !percent.is_finite() {
        return 0.0;
    }
    percent.clamp(0.0, 100.0)
}

fn select_weekly_remaining_percent(models: &[ModelRemain]) -> Option<f64> {
    models
        .iter()
        .filter_map(|m| m.current_weekly_remaining_percent.map(clamp_percent))
        .reduce(f64::min)
}

fn business_status_code(payload: &MiniMaxResponse) -> Option<i32> {
    payload
        .status_code
        .or(payload.base_resp.as_ref().and_then(|b| b.status_code))
}

fn is_business_success(payload: &MiniMaxResponse) -> bool {
    business_status_code(payload).unwrap_or(0) == 0
}

fn fetch_minimax_payload_blocking_with_compat(
    api_key: &str,
    timeout_ms: u64,
    token_plan_url: &str,
    legacy_url: &str,
) -> Result<(MiniMaxResponse, UsageCountSemantics), Box<dyn std::error::Error + Send + Sync>> {
    match fetch_minimax_payload_blocking(api_key, timeout_ms, token_plan_url) {
        Ok(payload) if is_business_success(&payload) => Ok((payload, UsageCountSemantics::Used)),
        Ok(primary_error_payload) => {
            match fetch_minimax_payload_blocking(api_key, timeout_ms, legacy_url) {
                Ok(legacy_payload) if is_business_success(&legacy_payload) => {
                    Ok((legacy_payload, UsageCountSemantics::Remaining))
                }
                _ => Ok((primary_error_payload, UsageCountSemantics::Used)),
            }
        }
        Err(primary_error) => match fetch_minimax_payload_blocking(api_key, timeout_ms, legacy_url)
        {
            Ok(legacy_payload) => Ok((legacy_payload, UsageCountSemantics::Remaining)),
            Err(legacy_error) => Err(format!(
                "{}; legacy coding_plan endpoint failed: {}",
                primary_error, legacy_error
            )
            .into()),
        },
    }
}

fn fetch_minimax_payload_blocking(
    api_key: &str,
    timeout_ms: u64,
    url: &str,
) -> Result<MiniMaxResponse, Box<dyn std::error::Error + Send + Sync>> {
    match fetch_minimax_payload_reqwest(api_key, timeout_ms, url) {
        Ok(payload) => Ok(payload),
        Err(error) => {
            let reqwest_error = format_reqwest_error(&error);
            if !error.is_timeout() && !error.is_connect() {
                return Err(reqwest_error.into());
            }

            #[cfg(target_os = "macos")]
            {
                log::warn!(
                    "MiniMax request failed through reqwest, trying system curl fallback: {}",
                    reqwest_error
                );
                match fetch_minimax_payload_curl(api_key, timeout_ms, url) {
                    Ok(payload) => {
                        log::info!("MiniMax request recovered through system curl fallback");
                        Ok(payload)
                    }
                    Err(curl_error) => Err(format!(
                        "{}; system curl fallback failed: {}",
                        reqwest_error, curl_error
                    )
                    .into()),
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                #[allow(clippy::needless_return)]
                return Err(reqwest_error.into());
            }
        }
    }
}

fn fetch_minimax_payload_reqwest(
    api_key: &str,
    timeout_ms: u64,
    url: &str,
) -> Result<MiniMaxResponse, reqwest::Error> {
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(CONNECT_TIMEOUT_MS))
        .timeout(Duration::from_millis(timeout_ms))
        .build()?;

    client
        .get(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .send()
        .and_then(|response| response.json::<MiniMaxResponse>())
}

#[cfg(target_os = "macos")]
fn fetch_minimax_payload_curl(
    api_key: &str,
    timeout_ms: u64,
    url: &str,
) -> Result<MiniMaxResponse, Box<dyn std::error::Error + Send + Sync>> {
    validate_header_value(api_key)?;

    let connect_timeout = seconds_for_curl(CONNECT_TIMEOUT_MS);
    let max_time_ms = timeout_ms.clamp(1_000, CURL_FALLBACK_MAX_TIME_MS);
    let max_time = seconds_for_curl(max_time_ms);
    let auth_header = format!("Authorization: Bearer {}", api_key.trim());
    let config = format!("header = \"{}\"\n", curl_config_quote_value(&auth_header));

    let mut child = Command::new("/usr/bin/curl")
        .arg("-sS")
        .arg("--connect-timeout")
        .arg(&connect_timeout)
        .arg("--max-time")
        .arg(&max_time)
        .arg("--request")
        .arg("GET")
        .arg("--url")
        .arg(url)
        .arg("--header")
        .arg("Content-Type: application/json")
        .arg("--header")
        .arg("Accept: application/json")
        .arg("--config")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start /usr/bin/curl: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(config.as_bytes())
            .map_err(|e| format!("failed to write curl config: {}", e))?;
    } else {
        return Err("failed to open curl stdin for config".into());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for curl: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "curl exited with {}; stderr: {}",
            output.status,
            truncate_for_error(&stderr, 500)
        )
        .into());
    }

    serde_json::from_slice::<MiniMaxResponse>(&output.stdout).map_err(|e| {
        let stdout = String::from_utf8_lossy(&output.stdout);
        format!(
            "failed to parse curl response JSON: {}; body: {}",
            e,
            truncate_for_error(&stdout, 500)
        )
        .into()
    })
}

#[cfg(target_os = "macos")]
fn seconds_for_curl(ms: u64) -> String {
    let seconds = (ms as f64 / 1000.0).max(0.001);
    format!("{:.3}", seconds)
}

#[cfg(target_os = "macos")]
fn validate_header_value(value: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if value.trim().is_empty() {
        return Err("API key is empty".into());
    }
    if value.chars().any(|ch| ch.is_control()) {
        return Err("API key contains unsupported control characters".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn curl_config_quote_value(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            _ => quoted.push(ch),
        }
    }
    quoted
}

#[cfg(target_os = "macos")]
fn truncate_for_error(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

fn format_reqwest_error(error: &reqwest::Error) -> String {
    let mut message = format!(
        "{} (timeout={}, connect={}, status={:?})",
        error,
        error.is_timeout(),
        error.is_connect(),
        error.status()
    );
    let mut source = error.source();
    while let Some(err) = source {
        message.push_str("; caused by: ");
        message.push_str(&err.to_string());
        source = err.source();
    }
    message
}

fn format_duration(seconds: i64) -> String {
    if seconds <= 0 {
        return "00:00".to_string();
    }
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{:02}:{:02}", minutes, secs)
    }
}

fn format_english_duration(total_seconds: i64) -> String {
    if total_seconds <= 0 {
        return "0m".to_string();
    }
    let days = total_seconds / 86400;
    let hours = (total_seconds % 86400) / 3600;
    let minutes = (total_seconds % 3600) / 60;

    if days > 0 {
        format!("{}d", days)
    } else if hours > 0 {
        format!("{}h", hours)
    } else {
        format!("{}m", minutes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn make_model(
        name: &str,
        current_total: i64,
        current_used: i64,
        weekly_total: i64,
        weekly_used: i64,
    ) -> ModelRemain {
        ModelRemain {
            start_time: Some(1_780_243_200_000),
            end_time: Some(1_780_329_600_000),
            remains_time: Some(37_518_794),
            current_interval_total_count: Some(current_total),
            current_interval_usage_count: Some(current_used),
            current_interval_remaining_percent: None,
            model_name: Some(name.to_string()),
            current_weekly_total_count: Some(weekly_total),
            current_weekly_usage_count: Some(weekly_used),
            current_weekly_remaining_percent: None,
            weekly_remains_time: Some(555_918_794),
        }
    }

    #[test]
    fn select_primary_model_prefers_general_model() {
        let models = vec![
            make_model("general", 0, 0, 0, 0),
            make_model("video", 3, 0, 21, 0),
        ];

        let primary = select_primary_model(&models).expect("primary model");

        assert_eq!(primary.model_name.as_deref(), Some("general"));
    }

    #[test]
    fn payload_mapping_infers_counts_from_general_remaining_percent() {
        let mut plan_model = make_model("general", 0, 0, 0, 0);
        plan_model.current_interval_remaining_percent = Some(95.0);
        plan_model.current_weekly_remaining_percent = Some(97.0);
        let payload = MiniMaxResponse {
            base_resp: Some(BaseResp {
                status_code: Some(0),
                status_msg: Some("success".to_string()),
            }),
            status_code: None,
            status_msg: None,
            model_remains: Some(vec![plan_model, make_model("video", 3, 0, 21, 0)]),
        };
        let now = Local.with_ymd_and_hms(2026, 6, 1, 13, 40, 0).unwrap();

        let mut usage = build_usage_data_from_payload(payload, now, UsageCountSemantics::Used);
        apply_configured_quota_counts(&mut usage, 1500, 15000);

        assert!(usage.ok);
        assert_eq!(usage.primary_model_name, "general");
        assert_eq!(usage.total_count, Some(1500));
        assert_eq!(usage.remaining_count, Some(1425));
        assert_eq!(usage.used_count, Some(75));
        assert_eq!(usage.used_percent, Some(5.0));
        assert_eq!(usage.weekly_total_count, Some(15000));
        assert_eq!(usage.weekly_remaining_count, Some(14550));
        assert_eq!(usage.weekly_used_count, Some(450));
        assert_eq!(usage.weekly_used_percent, Some(3.0));
        assert_eq!(usage.models.len(), 1);
        assert_eq!(usage.models[0].name, "video");
    }

    #[test]
    fn payload_mapping_treats_usage_count_as_used_count() {
        let payload = MiniMaxResponse {
            base_resp: Some(BaseResp {
                status_code: Some(0),
                status_msg: Some("success".to_string()),
            }),
            status_code: None,
            status_msg: None,
            model_remains: Some(vec![make_model("video", 10, 4, 21, 5)]),
        };
        let now = Local.with_ymd_and_hms(2026, 6, 1, 13, 40, 0).unwrap();

        let usage = build_usage_data_from_payload(payload, now, UsageCountSemantics::Used);

        assert_eq!(usage.total_count, Some(10));
        assert_eq!(usage.used_count, Some(4));
        assert_eq!(usage.remaining_count, Some(6));
        assert_eq!(usage.used_percent, Some(40.0));
        assert_eq!(usage.weekly_total_count, Some(21));
        assert_eq!(usage.weekly_used_count, Some(5));
        assert_eq!(usage.weekly_remaining_count, Some(16));
    }

    #[test]
    fn payload_mapping_keeps_legacy_remaining_count_semantics() {
        let payload = MiniMaxResponse {
            base_resp: Some(BaseResp {
                status_code: Some(0),
                status_msg: Some("success".to_string()),
            }),
            status_code: None,
            status_msg: None,
            model_remains: Some(vec![make_model("video", 10, 6, 21, 16)]),
        };
        let now = Local.with_ymd_and_hms(2026, 6, 1, 13, 40, 0).unwrap();

        let usage = build_usage_data_from_payload(payload, now, UsageCountSemantics::Remaining);

        assert_eq!(usage.total_count, Some(10));
        assert_eq!(usage.used_count, Some(4));
        assert_eq!(usage.remaining_count, Some(6));
        assert_eq!(usage.weekly_used_count, Some(5));
        assert_eq!(usage.weekly_remaining_count, Some(16));
    }

    #[test]
    fn payload_mapping_uses_weekly_remaining_percent_from_general_model() {
        let mut plan_model = make_model("general", 0, 0, 0, 0);
        plan_model.current_weekly_remaining_percent = Some(89.0);
        let mut video_model = make_model("video", 3, 0, 21, 0);
        video_model.current_weekly_remaining_percent = Some(100.0);
        let payload = MiniMaxResponse {
            base_resp: Some(BaseResp {
                status_code: Some(0),
                status_msg: Some("success".to_string()),
            }),
            status_code: None,
            status_msg: None,
            model_remains: Some(vec![plan_model, video_model]),
        };
        let now = Local.with_ymd_and_hms(2026, 6, 1, 13, 40, 0).unwrap();

        let usage = build_usage_data_from_payload(payload, now, UsageCountSemantics::Used);

        assert_eq!(usage.primary_model_name, "general");
        assert_eq!(usage.weekly_remaining_percent, Some(89.0));
        assert_eq!(usage.weekly_used_percent, Some(11.0));
    }
}
