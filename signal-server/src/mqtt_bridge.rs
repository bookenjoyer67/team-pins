use std::sync::Arc;
use std::time::Duration;

use prost::Message;
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use tokio::sync::{mpsc, Semaphore};
use tokio::time::sleep;
use tracing::{info, warn};

static MQTT_SEM: std::sync::LazyLock<Semaphore> = std::sync::LazyLock::new(|| Semaphore::new(50));

use crate::room::Room;
use crate::state::AppState;

use meshtastic_protobufs::meshtastic::mesh_packet::PayloadVariant;
use meshtastic_protobufs::meshtastic::{PortNum, ServiceEnvelope};

pub async fn start_bridge(state: Arc<AppState>) {
    let cfg = &state.config.mqtt;
    if !cfg.enabled {
        info!("MQTT bridge disabled");
        return;
    }

    let mut mqtt_opts = MqttOptions::new("!piggpin-bridge", &cfg.broker, cfg.port);
    mqtt_opts.set_keep_alive(Duration::from_secs(10));
    mqtt_opts.set_clean_session(false);
    mqtt_opts.set_max_packet_size(256 * 1024, 256 * 1024);
    if !cfg.username.is_empty() {
        mqtt_opts.set_credentials(&cfg.username, &cfg.password);
    }

    let (client, mut eventloop) = AsyncClient::new(mqtt_opts, 256);

    // Store client in state so uplink can use latest connection
    {
        let mut c = state.mqtt_client.write().await;
        *c = Some(Arc::new(client.clone()));
    }

    let room_name = cfg.bridge_room.clone();

    // Set up uplink channel: handler → bridge → MQTT
    let (uplink_tx, mut uplink_rx) = mpsc::channel::<String>(256);
    {
        let mut tx_lock = state.mesh_uplink.write().await;
        *tx_lock = Some(uplink_tx);
    }

    // Queue latest position for republish on reconnect
    let last_position: Arc<tokio::sync::Mutex<Option<(u32, i32, i32, i32, String, String, u64)>>> = Arc::new(tokio::sync::Mutex::new(None));

    // Uplink task: forward PWA messages to MQTT
    let uplink_state = state.clone();
    let uplink_room = room_name.clone();
    let uplink_root = cfg.root_topic.clone();
    let uplink_pos = last_position.clone();
    tokio::spawn(async move {
        use meshtastic_protobufs::meshtastic::mesh_packet::PayloadVariant;
        use meshtastic_protobufs::meshtastic::{Data, MeshPacket};
        while let Some(raw) = uplink_rx.recv().await {
            // Get current MQTT client from shared state
            let uplink_client = {
                let guard = uplink_state.mqtt_client.read().await;
                guard.clone()
            };
            let Some(uplink_client) = uplink_client else {
                sleep(Duration::from_secs(1)).await;
                continue;
            };

            // Try position uplink first
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if v.get("type").and_then(|t| t.as_str()) == Some("mesh_uplink_presence") {
                    // Publish a minimal nodeinfo to the e topic so meshview recognizes this node
                    if let Some(node) = v.get("node").and_then(|n| n.as_u64()) {
                        let from = node as u32;
                        let id: u32 = {
                            let mut buf = [0u8; 4];
                            let _ = getrandom::getrandom(&mut buf);
                            u32::from_le_bytes(buf)
                        };
                        let nodeinfo = meshtastic_protobufs::meshtastic::User {
                            id: from.to_string(),
                            long_name: "piggpin.space".to_string(),
                            short_name: "O--".to_string(),
                            hw_model: 43,
                            ..Default::default()
                        };
                        let mut ni_buf = Vec::new();
                        if nodeinfo.encode(&mut ni_buf).is_ok() {
                            let mesh_packet = MeshPacket {
                                from,
                                to: 0xFFFFFFFF,
                                id,
                                want_ack: false,
                                payload_variant: Some(PayloadVariant::Decoded(Data {
                                    portnum: meshtastic_protobufs::meshtastic::PortNum::NodeinfoApp as i32,
                                    payload: ni_buf,
                                    want_response: false,
                                    ..Default::default()
                                })),
                                ..Default::default()
                            };
                            let envelope = ServiceEnvelope {
                                packet: Some(mesh_packet),
                                channel_id: "LongFast".to_string(),
                                gateway_id: format!("!{:x}", from),
                            };
                            let mut buf = Vec::new();
                            if envelope.encode(&mut buf).is_ok() {
                                let topic = format!("{}/2/e/LongFast/!{:x}", uplink_root, from);
                                let _ = uplink_client.publish(&topic, QoS::AtMostOnce, false, buf).await;
                            }
                        }
                    }
                    continue;
                }

                if v.get("type").and_then(|t| t.as_str()) == Some("mesh_uplink_position") {
                    let from = v.get("from").and_then(|f| f.as_u64()).unwrap_or(0) as u32;
                    let lat = v.get("latitude_i").and_then(|l| l.as_i64()).unwrap_or(0) as i32;
                    let lng = v.get("longitude_i").and_then(|l| l.as_i64()).unwrap_or(0) as i32;
                    let alt = v.get("altitude").and_then(|a| a.as_i64()).unwrap_or(0) as i32;

                    if lat != 0 && lng != 0 {
                        // Queue for republish on reconnect
                        {
                            let name = v.get("long_name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                            let sname = v.get("short_name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                            let hw = v.get("hw_model").and_then(|h| h.as_u64()).unwrap_or(0);
                            *uplink_pos.lock().await = Some((from, lat, lng, alt, name, sname, hw));
                        }
                        let id: u32 = {
                            let mut buf = [0u8; 4];
                            let _ = getrandom::getrandom(&mut buf);
                            u32::from_le_bytes(buf)
                        };
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        let report = serde_json::json!({
                            "type": "position",
                            "from": from,
                            "id": id,
                            "timestamp": now,
                            "long_name": v.get("long_name").and_then(|n| n.as_str()).unwrap_or(""),
                            "short_name": v.get("short_name").and_then(|n| n.as_str()).unwrap_or(""),
                            "hw_model": v.get("hw_model").and_then(|h| h.as_u64()).unwrap_or(0),
                            "payload": {
                                "latitude_i": lat,
                                "longitude_i": lng,
                                "altitude": alt,
                                "time": now,
                                "precision_bits": 16,
                            }
                        });
                        let topic = format!("{}/2/json/LongFast/!{:x}", uplink_root, from);
                        let _ = uplink_client.publish(&topic, QoS::AtMostOnce, false, report.to_string().into_bytes()).await;
                        info!("MQTT published position for node {} to json topic", from);
                    }
                    continue;
                }
            }

            // Regular text uplink
            let (payload, to_node): (String, Option<u64>) =
                match serde_json::from_str::<serde_json::Value>(&raw) {
                    Ok(v) => (
                        v.get("p").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                        v.get("to").and_then(|t| t.as_u64()),
                    ),
                    Err(_) => continue,
                };
            if payload.is_empty() { continue; }

            let id: u32 = {
                let mut buf = [0u8; 4];
                let _ = getrandom::getrandom(&mut buf);
                u32::from_le_bytes(buf)
            };
            let mesh_packet = MeshPacket {
                from: 0,
                to: to_node.unwrap_or(0xFFFFFFFF) as u32,
                id,
                want_ack: false,
                payload_variant: Some(PayloadVariant::Decoded(Data {
                    portnum: meshtastic_protobufs::meshtastic::PortNum::TextMessageApp as i32,
                    payload: payload.clone().into_bytes(),
                    want_response: false,
                    ..Default::default()
                })),
                ..Default::default()
            };

            let envelope = ServiceEnvelope {
                packet: Some(mesh_packet),
                channel_id: "LongFast".to_string(),
                gateway_id: "piggpin-gateway".to_string(),
            };

            let mut buf = Vec::new();
            if envelope.encode(&mut buf).is_err() { continue; }

            let topic = format!("{}/2/c/LongFast/piggpin-gateway", uplink_root);
            if let Err(e) = uplink_client
                .publish(topic, QoS::AtMostOnce, false, buf)
                .await
            {
                warn!("MQTT uplink publish failed: {}", e);
            } else {
                let mode = if to_node.is_some() { "direct" } else { "broadcast" };
                info!("MQTT uplink {} {} bytes", mode, payload.len());
            }

            // Echo back to WS room so the sender can verify loopback
            let echo = serde_json::json!({
                "type": "mesh_text",
                "from": 0,
                "to": 0xFFFFFFFFu32,
                "channel": "LongFast",
                "gateway": "piggpin-gateway",
                "data": payload,
            });
            relay_to_room(&uplink_state, &uplink_room, &echo).await;
        }
    });

    info!(
        "MQTT bridge connecting to {}:{} — relay to room '{}'",
        cfg.broker, cfg.port, cfg.bridge_room
    );

    {
        if !state.rooms.contains_key(&room_name) {
            state.rooms.insert(room_name.clone(), Room::new());
        }
    }

    let state_room = state.clone();
    let room_keepalive = room_name.clone();
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(120)).await;
            if let Some(room) = state_room.rooms.get(&room_keepalive) {
                room.touch();
            }
        }
    });

    loop {
        match eventloop.poll().await {
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                info!("MQTT bridge connected to {}", cfg.broker);
                // Update stored client for position uplinks
                {
                    let mut c = state.mqtt_client.write().await;
                    *c = Some(Arc::new(client.clone()));
                }
                let root = &cfg.root_topic;
                // Only subscribe to essential topics — reduces broker load
                let topics = [
                    format!("{}/2/e/#", root),
                    format!("{}/2/json/#", root),
                ];
                for topic in &topics {
                    match client.subscribe(topic, QoS::AtMostOnce).await {
                        Ok(_) => info!("Subscribed to {}", topic),
                        Err(e) => warn!("Subscribe to {} failed: {}", topic, e),
                    }
                    sleep(Duration::from_secs(1)).await;
                }
                // Subscribe to c and stat with delay to avoid rate limiting
                for topic in &[format!("{}/2/c/#", root), format!("{}/2/stat/#", root)] {
                    sleep(Duration::from_secs(3)).await;
                    let _ = client.subscribe(topic, QoS::AtMostOnce).await;
                }
                info!("All subscriptions sent — waiting for messages");

                // Republish queued position on reconnect
                if let Some(ref pos) = *last_position.lock().await {
                    let (from, lat, lng, alt, ref name, ref sname, hw) = *pos;
                    let id: u32 = {
                        let mut buf = [0u8; 4];
                        let _ = getrandom::getrandom(&mut buf);
                        u32::from_le_bytes(buf)
                    };
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    let report = serde_json::json!({
                        "type": "position",
                        "from": from,
                        "id": id,
                        "timestamp": now,
                        "long_name": name,
                        "short_name": sname,
                        "hw_model": hw,
                        "payload": {
                            "latitude_i": lat,
                            "longitude_i": lng,
                            "altitude": alt,
                            "time": now,
                            "precision_bits": 16,
                        }
                    });
                    let topic = format!("{}/2/json/LongFast/!{:x}", cfg.root_topic, from);
                    let _ = client.publish(&topic, QoS::AtMostOnce, false, report.to_string().into_bytes()).await;
                    info!("Republished position for node {} on reconnect", from);
                }
            }
            Ok(Event::Incoming(Packet::Publish(publish))) => {
                info!("MQTT message on topic: {}", publish.topic);
                let topic = publish.topic.clone();
                let payload = publish.payload.to_vec();
                let spawn_state = state.clone();
                let spawn_room = room_name.clone();

                let permit = MQTT_SEM.acquire().await;
                tokio::spawn(async move {
                    let _permit = permit;
                    handle_mqtt_message(
                    spawn_state,
                    spawn_room,
                    topic,
                    payload,
                ).await;
                });
            }
            Ok(_) => {}
            Err(e) => {
                warn!("MQTT disconnected (will retry in 15s): {}", e);
                sleep(Duration::from_secs(15)).await;
            }
        }
    }
}

async fn handle_mqtt_message(
    state: Arc<AppState>,
    room_name: String,
    topic: String,
    payload: Vec<u8>,
) {
    let envelope = match ServiceEnvelope::decode(payload.as_slice()) {
        Ok(e) => e,
        Err(_) => {
            if let Ok(text) = String::from_utf8(payload.clone()) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&text) {
                    // Inject node ID from topic: msh/.../.../.../!nodeid
                    if let Some(node_id) = topic.split('/').last().and_then(|s| s.strip_prefix('!')) {
                        if let Ok(node_num) = u32::from_str_radix(node_id, 16) {
                            if json.get("from").is_none() {
                                if let Some(obj) = json.as_object_mut() {
                                    obj.insert("from".into(), serde_json::json!(node_num));
                                }
                            }
                        }
                    }
                    // Log the actual JSON for positions/nodeinfos to debug format
                    let has_pos = json.get("latitudeI").or(json.get("latitude_i")).is_some();
                    let has_name = json.get("longName").or(json.get("long_name")).is_some();
                    if has_pos || has_name {
                        info!("MQTT JSON payload on {}: {}", topic, json.to_string());
                    }
                    relay_to_room(&state, &room_name, &json).await;
                    return;
                }
            }
            return;
        }
    };

    let packet = match envelope.packet {
        Some(p) => p,
        None => return,
    };

    let from_node = packet.from;
    let to_node = packet.to;

    // Handle encrypted packets — relay what we can (topic, node IDs)
    let decoded = match packet.payload_variant {
        Some(PayloadVariant::Decoded(ref d)) => d,
        _ => {
            // Encrypted — relay as unknown with topic and node info
            relay_to_room(
                &state,
                &room_name,
                &serde_json::json!({
                    "type": "mesh_encrypted",
                    "from": from_node,
                    "to": to_node,
                    "channel": envelope.channel_id,
                    "gateway": envelope.gateway_id,
                    "topic": topic,
                }),
            ).await;
            return;
        }
    };

    let portnum = PortNum::try_from(decoded.portnum).unwrap_or(PortNum::UnknownApp);
    let raw_payload = &decoded.payload;

    match portnum {
        PortNum::TextMessageApp => {
            if let Ok(text) = String::from_utf8(raw_payload.clone()) {
                relay_to_room(
                    &state,
                    &room_name,
                    &serde_json::json!({
                        "type": "mesh_text",
                        "from": from_node,
                        "to": to_node,
                        "channel": envelope.channel_id,
                        "gateway": envelope.gateway_id,
                        "data": text,
                    }),
                ).await;
            }
        }
        PortNum::PositionApp => {
            if let Ok(pos) =
                meshtastic_protobufs::meshtastic::Position::decode(raw_payload.as_slice())
            {
                relay_to_room(
                    &state,
                    &room_name,
                    &serde_json::json!({
                        "type": "mesh_position",
                        "from": from_node,
                        "to": to_node,
                        "channel": envelope.channel_id,
                        "gateway": envelope.gateway_id,
                        "data": {
                            "latitude_i": pos.latitude_i,
                            "longitude_i": pos.longitude_i,
                            "altitude": pos.altitude,
                            "time": pos.time,
                        },
                    }),
                ).await;
            }
        }
        PortNum::TelemetryApp => {
            relay_to_room(
                &state,
                &room_name,
                &serde_json::json!({
                    "type": "mesh_telemetry",
                    "from": from_node,
                    "to": to_node,
                    "channel": envelope.channel_id,
                    "gateway": envelope.gateway_id,
                    "data_hex": hex::encode(raw_payload),
                }),
            ).await;
        }
        PortNum::NodeinfoApp => {
            if let Ok(user) =
                meshtastic_protobufs::meshtastic::User::decode(raw_payload.as_slice())
            {
                relay_to_room(
                    &state,
                    &room_name,
                    &serde_json::json!({
                        "type": "mesh_nodeinfo",
                        "from": from_node,
                        "to": to_node,
                        "channel": envelope.channel_id,
                        "gateway": envelope.gateway_id,
                        "data": {
                            "id": user.id,
                            "long_name": user.long_name,
                            "short_name": user.short_name,
                            "hw_model": user.hw_model,
                            "role": user.role,
                        },
                    }),
                ).await;
            }
        }
        _ => {
            relay_to_room(
                &state,
                &room_name,
                &serde_json::json!({
                    "type": "mesh_packet",
                    "from": from_node,
                    "to": to_node,
                    "portnum": decoded.portnum,
                    "channel": envelope.channel_id,
                    "gateway": envelope.gateway_id,
                    "data_hex": hex::encode(raw_payload),
                }),
            ).await;
        }
    }
}

async fn relay_to_room(state: &AppState, room_name: &str, data: &serde_json::Value) {
    if !state.rooms.contains_key(room_name) {
        state.rooms.insert(room_name.to_string(), Room::new());
    }
    let room = match state.rooms.get(room_name) {
        Some(r) => r,
        None => { warn!("[mqtt] failed to create room {}", room_name); return; }
    };
    let txt = data.to_string();
    if txt.len() > state.config.security.max_message_size {
        warn!(
            "MQTT message too large for room relay ({} bytes)",
            txt.len()
        );
        return;
    }
    if let Some(msg_type) = data.get("type").and_then(|t| t.as_str()) {
        let from = data.get("from").and_then(|f| f.as_u64()).unwrap_or(0);
        info!("MQTT → room: {} from node {}", msg_type, from);
    }
    room.broadcast(&txt, "");
}
