//! 完整的 Config + API Key Delete 集成测试

use std::env;
use std::fs;

use minimax_usage_monitor_lib::{api_key_store, config, ApiKeyEntry};

static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn unique_test_dir() -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let pid = std::process::id();
    let test_dir = std::env::temp_dir().join(format!("minimax-del-test-{}-{}", pid, nanos));
    fs::create_dir_all(&test_dir).unwrap();
    test_dir
}

fn create_test_entry(name: &str, color: &str) -> ApiKeyEntry {
    ApiKeyEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        color: color.to_string(),
        keychain_service: "com.decard.test".to_string(),
        keychain_account: uuid::Uuid::new_v4().to_string(),
        refresh_interval: 20,
        current_quota_count: 1500,
        weekly_quota_count: 15000,
        created_at: chrono::Utc::now().timestamp(),
        is_active: true,
        endpoint: "domestic".to_string(),
    }
}

#[test]
fn test_delete_workflow_simulation() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let test_dir = unique_test_dir();
    env::set_var(
        "MINIMAX_MONITOR_CONFIG_DIR",
        test_dir.to_string_lossy().as_ref(),
    );
    env::set_var("MINIMAX_MONITOR_DISABLE_KEYCHAIN", "1");

    println!("Test dir: {:?}", test_dir);

    let entry1 = create_test_entry("Key1", "#ff0000");
    let entry2 = create_test_entry("Key2", "#00ff00");
    let entry3 = create_test_entry("Key3", "#0000ff");

    api_key_store::save_key_for_entry(&entry1, "key1").unwrap();
    api_key_store::save_key_for_entry(&entry2, "key2").unwrap();
    api_key_store::save_key_for_entry(&entry3, "key3").unwrap();

    let mut app_config = minimax_usage_monitor_lib::AppConfig::default();
    app_config.api_keys.push(entry1.clone());
    app_config.api_keys.push(entry2.clone());
    app_config.api_keys.push(entry3.clone());
    config::save_config(&app_config).unwrap();

    let saved = config::load_config().unwrap();
    assert_eq!(saved.api_keys.len(), 3, "Should have 3 keys");
    println!("✓ Config saved with 3 keys");

    // 模拟 delete: 删除 entry2
    let id_to_delete = entry2.id.clone();
    api_key_store::delete_key_for_entry(&entry2).unwrap();

    let mut loaded = config::load_config().unwrap();
    println!("Loaded config has {} keys", loaded.api_keys.len());

    loaded.api_keys.retain(|e| e.id != id_to_delete);
    println!("After retain: {} keys", loaded.api_keys.len());

    config::save_config(&loaded).unwrap();

    let final_config = config::load_config().unwrap();
    assert_eq!(final_config.api_keys.len(), 2);

    let ids: Vec<_> = final_config.api_keys.iter().map(|e| e.id.clone()).collect();
    assert!(ids.contains(&entry1.id));
    assert!(ids.contains(&entry3.id));
    assert!(!ids.contains(&id_to_delete));

    let final_entry1 = final_config
        .api_keys
        .iter()
        .find(|e| e.id == entry1.id)
        .unwrap();
    let final_entry3 = final_config
        .api_keys
        .iter()
        .find(|e| e.id == entry3.id)
        .unwrap();
    assert_eq!(
        api_key_store::load_key_for_entry(final_entry1),
        Some("key1".to_string())
    );
    assert_eq!(
        api_key_store::load_key_for_entry(final_entry3),
        Some("key3".to_string())
    );

    println!("✓ All assertions passed!");
    fs::remove_dir_all(&test_dir).ok();
}

#[test]
fn test_delete_preserves_other_keys() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let test_dir = unique_test_dir();
    env::set_var(
        "MINIMAX_MONITOR_CONFIG_DIR",
        test_dir.to_string_lossy().as_ref(),
    );
    env::set_var("MINIMAX_MONITOR_DISABLE_KEYCHAIN", "1");

    let entries: Vec<_> = (0..5)
        .map(|i| {
            let e = create_test_entry(&format!("Key{}", i), &format!("#{:06x}", i * 0x33333));
            api_key_store::save_key_for_entry(&e, &format!("secret-{}", i)).ok();
            e
        })
        .collect();

    let mut cfg = minimax_usage_monitor_lib::AppConfig::default();
    cfg.api_keys = entries.clone();
    config::save_config(&cfg).unwrap();

    let id_to_delete = entries[2].id.clone();
    api_key_store::delete_key_for_entry(&entries[2]).unwrap();

    let mut loaded = config::load_config().unwrap();
    loaded.api_keys.retain(|e| e.id != id_to_delete);
    config::save_config(&loaded).unwrap();

    let final_cfg = config::load_config().unwrap();
    assert_eq!(final_cfg.api_keys.len(), 4);
    assert_eq!(final_cfg.api_keys[0].name, "Key0");
    assert_eq!(final_cfg.api_keys[1].name, "Key1");
    assert_eq!(final_cfg.api_keys[2].name, "Key3");
    assert_eq!(final_cfg.api_keys[3].name, "Key4");

    println!("✓ Order preserved: Key0, Key1, Key3, Key4");
    fs::remove_dir_all(&test_dir).ok();
}
