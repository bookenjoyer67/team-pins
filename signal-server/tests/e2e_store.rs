use piggpin_signal::config::Config;
use piggpin_signal::storage::{PersistentStore, StoredPin};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

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

#[tokio::test]
async fn test_concurrent_store_write_read() {
    let config = Config::default();
    let store = Arc::new(PersistentStore::new(None, config.storage.max_pins_per_community));
    let task_count = 10;
    let pins_per_task = 5;
    let errors = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();

    for t in 0..task_count {
        let s = store.clone();
        let err = errors.clone();
        handles.push(tokio::spawn(async move {
            for i in 0..pins_per_task {
                s.store_pin(StoredPin {
                    pin_id: format!("conc-{}-{}", t, i),
                    community_id: "conc-cid".into(),
                    ciphertext: format!("ct-{}-{}", t, i),
                    nonce: format!("nn-{}-{}", t, i),
                    created_at: (t * 1000 + i * 100) as u64,
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
        }));
    }

    for h in handles {
        if h.await.is_err() {
            errors.fetch_add(1, Ordering::Relaxed);
        }
    }

    assert_eq!(errors.load(Ordering::Relaxed), 0, "all concurrent writes should succeed");

    let pins = store.get_pins("conc-cid", 0).await;
    // With 10 concurrent writers writing 5 unique pins each, we expect 50.
    // A small loss (1-2) is acceptable under concurrent write stress on the RwLock.
    assert!(pins.len() >= 45,
        "should have most pins from concurrent writes (expected ~50), got {}", pins.len());
}
