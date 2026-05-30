use piggpin_signal::config::Config;
use piggpin_signal::storage::{PersistentStore, StoredPin};

#[tokio::test]
async fn test_store_pin_directly() {
    let config = Config::default();
    let store = PersistentStore::new(None, config.storage.max_pins_per_community);

    let pin = StoredPin {
        pin_id: "test-pin-1".into(),
        community_id: "test-cid".into(),
        ciphertext: "aa".into(),
        nonce: "bb".into(),
        created_at: 1000,
        author_pubkey: String::new(),
        media: None,
        posted_anonymously: false,
        ttl_expires_at: None,
        ttl_base_at: None,
        vote_count_up: 0,
        vote_count_down: 0,
        layer_id: None,
        emoji: None,
    };
    store.store_pin(pin).await;

    let pins = store.get_pins("test-cid", 0).await;
    assert_eq!(pins.len(), 1, "should have 1 pin after store_pin, got {}", pins.len());
}

#[tokio::test]
async fn test_store_pin_multiple() {
    let config = Config::default();
    let store = PersistentStore::new(None, config.storage.max_pins_per_community);

    for i in 1..=4 {
        store.store_pin(StoredPin {
            pin_id: format!("pin-{}", i),
            community_id: "multi-cid".into(),
            ciphertext: format!("cc{}", i),
            nonce: format!("nn{}", i),
            created_at: 1000 + i * 100,
            author_pubkey: String::new(),
            media: None,
            posted_anonymously: false,
            ttl_expires_at: None,
            ttl_base_at: None,
            vote_count_up: 0,
            vote_count_down: 0,
            layer_id: None,
            emoji: None,
        }).await;
    }

    let pins = store.get_pins("multi-cid", 0).await;
    assert_eq!(pins.len(), 4, "should have 4 pins, got {}", pins.len());

    // since filter
    let filtered = store.get_pins("multi-cid", 1200).await;
    assert!(filtered.len() < 4, "since filter should reduce count");
}
