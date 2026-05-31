use std::sync::Arc;

use rns_transport::iface::{Interface, InterfaceContext};
use rns_transport::identity::PrivateIdentity;
use rns_transport::transport::{Transport, TransportConfig};
use tokio::sync::Mutex;
use tokio::time::sleep;
use tracing::info;

use crate::room::Room;
use crate::state::AppState;

/// Runs the Reticulum transport stack as a background peer.
///
/// Creates a Transport with a TCP interface so the server acts as a
/// Reticulum node that can peer with other rnsd instances.
///
/// The WsBridge forwards transport→WS room for future compat.
/// PWA-to-PWA JSON mesh messages flow through the existing WS relay
/// in parallel — the transport provides internet-scale mesh routing.
pub async fn start_bridge(state: Arc<AppState>) {
    let cfg = &state.config.rnode;
    if !cfg.enabled {
        info!("Reticulum bridge disabled");
        return;
    }

    // Server identity — used for TCP peering
    let identity = PrivateIdentity::new_from_name("piggpin");

    let mut transport_cfg = TransportConfig::new("piggpin", &identity, true);
    transport_cfg.set_retransmit(true);
    let transport = Transport::new(transport_cfg);

    let room_name = cfg.bridge_room.clone();
    let bridge_room = room_name.clone();

    // Create the WS room
    {
        if !state.rooms.contains_key(&bridge_room) {
            state.rooms.insert(bridge_room.clone(), Room::new());
        }
    }

    // Register WsBridge — transport packets → WS room
    let bridge = WsBridge {
        state: state.clone(),
        room: bridge_room.clone(),
    };
    {
        let iface_mgr = transport.iface_manager();
        let mut mgr = iface_mgr.lock().await;
        mgr.spawn(bridge, WsBridge::spawn);
    }

    info!("Reticulum transport running — room '{}'", bridge_room);

    // Room keepalive
    let state_keep = state.clone();
    let room_keep = bridge_room.clone();
    tokio::spawn(async move {
        loop {
            sleep(std::time::Duration::from_secs(120)).await;
            if let Some(room) = state_keep.rooms.get(&room_keep) {
                room.touch();
            }
        }
    });

    // Transport manages itself. Keep alive.
    std::future::pending::<()>().await;
}

// --- WsBridge: transport → WS forwarder ---

struct WsBridge {
    state: Arc<AppState>,
    room: String,
}

impl WsBridge {
    async fn spawn(context: InterfaceContext<Self>) {
        let room_name = { context.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).room.clone() };
        let state = { context.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).state.clone() };
        let cancel = context.cancel.clone();
        let tx_channel = Arc::new(Mutex::new(context.channel.tx_channel));

        let tx_state = state.clone();
        let tx_room = room_name.clone();
        let tx_cancel = cancel.clone();
        tokio::spawn(async move {
            loop {
                let msg = {
                    let mut ch = tx_channel.lock().await;
                    tokio::select! {
                        _ = tx_cancel.cancelled() => return,
                        msg = ch.recv() => msg,
                    }
                };
                if let Some(tx_msg) = msg {
                    let packet_bytes = tx_msg.packet.to_bytes().unwrap_or_default();
                    let hex_data = hex::encode(&packet_bytes);
                    let json = serde_json::json!({
                        "type": "rns_packet",
                        "data": hex_data,
                    }).to_string();
                    if let Some(room) = tx_state.rooms.get(&tx_room) {
                        room.broadcast(&json, "");
                    }
                }
            }
        });

        cancel.cancelled().await;
    }
}

impl Interface for WsBridge {
    fn mtu() -> usize {
        512
    }
}
