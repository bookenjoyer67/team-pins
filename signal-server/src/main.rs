use tracing_subscriber::EnvFilter;

use piggpin_signal::relay;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("");

    match cmd {
        "stats" => {
            print_stats().await;
            Ok(())
        }
        _ => {
            let config = piggpin_signal::config::load_config();
            relay::start(config).await
        }
    }
}

async fn print_stats() {
    let config = piggpin_signal::config::load_config();
    let store = piggpin_signal::storage::PersistentStore::new(
        Some(std::path::PathBuf::from("community_data.json")),
        config.storage.max_pins_per_community,
    );
    let communities = store.communities.read().await.len();
    let pins_store = store.pins.read().await;
    let pins_total: usize = pins_store.values().map(|v| v.len()).sum();
    println!("Server not running (offline stats from snapshot)");
    println!("  Communities: {}\n  Pins stored: {}\n  Max connections: {}\n  Rate limit: {} msg/s",
        communities, pins_total, config.server.max_connections, config.rate_limit.messages_per_sec);
}
