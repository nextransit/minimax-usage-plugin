//! Multi-API Key Integration Tests

use std::fs;
use std::path::PathBuf;

fn test_config_dir() -> PathBuf {
    let test_dir = std::env::temp_dir()
        .join("minimax-test-")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&test_dir).ok();
    test_dir
}

use minimax_usage_monitor_lib::ApiKeyEntry;

#[test]
fn test_api_key_entry_fields() {
    let entry = ApiKeyEntry {
        id: "test-id".to_string(),
        name: "My API Key".to_string(),
        color: "#00d4ff".to_string(),
        keychain_service: "com.decard.minimax".to_string(),
        keychain_account: "account-1".to_string(),
        refresh_interval: 20,
        current_quota_count: 1500,
        weekly_quota_count: 15000,
        created_at: 1234567890,
        is_active: true,
        endpoint: "domestic".to_string(),
    };

    assert_eq!(entry.name, "My API Key");
    assert_eq!(entry.color, "#00d4ff");
    assert_eq!(entry.refresh_interval, 20);
    assert!(entry.is_active);
    assert_eq!(entry.id, "test-id");
}

#[test]
fn test_api_key_entry_unique_ids() {
    let entry1 = ApiKeyEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Key 1".to_string(),
        color: "#00d4ff".to_string(),
        keychain_service: "com.decard.test".to_string(),
        keychain_account: uuid::Uuid::new_v4().to_string(),
        refresh_interval: 20,
        current_quota_count: 1500,
        weekly_quota_count: 15000,
        created_at: chrono::Utc::now().timestamp(),
        is_active: true,
        endpoint: "domestic".to_string(),
    };

    let entry2 = ApiKeyEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Key 2".to_string(),
        color: "#ff6600".to_string(),
        keychain_service: "com.decard.test".to_string(),
        keychain_account: uuid::Uuid::new_v4().to_string(),
        refresh_interval: 30,
        current_quota_count: 1500,
        weekly_quota_count: 15000,
        created_at: chrono::Utc::now().timestamp(),
        is_active: true,
        endpoint: "domestic".to_string(),
    };

    assert_ne!(entry1.id, entry2.id);
    assert_ne!(entry1.keychain_account, entry2.keychain_account);
    assert_ne!(entry1.color, entry2.color);
    assert_ne!(entry1.refresh_interval, entry2.refresh_interval);
}

#[test]
fn test_api_key_entry_serialization() {
    let entry = ApiKeyEntry {
        id: "test-id".to_string(),
        name: "Test Key".to_string(),
        color: "#00d4ff".to_string(),
        keychain_service: "com.decard.test".to_string(),
        keychain_account: "test-account".to_string(),
        refresh_interval: 20,
        current_quota_count: 1500,
        weekly_quota_count: 15000,
        created_at: 1234567890,
        is_active: true,
        endpoint: "domestic".to_string(),
    };

    let json = serde_json::to_string(&entry).expect("Should serialize");
    assert!(json.contains("test-id"));
    assert!(json.contains("Test Key"));

    let loaded: ApiKeyEntry = serde_json::from_str(&json).expect("Should deserialize");
    assert_eq!(loaded.id, entry.id);
    assert_eq!(loaded.name, entry.name);
    assert_eq!(loaded.color, entry.color);
    assert_eq!(loaded.refresh_interval, entry.refresh_interval);
    assert_eq!(loaded.is_active, entry.is_active);
}

#[test]
fn test_multiple_entries_in_vec() {
    let mut entries = Vec::new();

    for i in 1..=3 {
        entries.push(ApiKeyEntry {
            id: uuid::Uuid::new_v4().to_string(),
            name: format!("Key {}", i),
            color: format!("#{:06x}", i * 0x111111),
            keychain_service: "com.decard.test".to_string(),
            keychain_account: uuid::Uuid::new_v4().to_string(),
            refresh_interval: 10 + i * 10,
            current_quota_count: 1500,
            weekly_quota_count: 15000,
            created_at: chrono::Utc::now().timestamp(),
            is_active: true,
            endpoint: "domestic".to_string(),
        });
    }

    assert_eq!(entries.len(), 3);

    let find_id = &entries[1].id;
    let found = entries.iter().find(|e| &e.id == find_id);
    assert!(found.is_some());
    assert_eq!(found.unwrap().name, "Key 2");

    entries.retain(|e| e.name != "Key 2");
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|e| e.name != "Key 2"));
}
