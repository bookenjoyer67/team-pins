use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::time::sleep;
use tracing::{error, info};

use crate::room::Room;
use crate::state::AppState;

const FEND: u8 = 0xC0;
const FESC: u8 = 0xDB;
const TFEND: u8 = 0xDC;
const TFESC: u8 = 0xDD;

fn kiss_encode(payload: &[u8]) -> Vec<u8> {
    let mut out = vec![FEND, 0x00]; // port 0 = data
    for &b in payload {
        if b == FEND {
            out.push(FESC);
            out.push(TFEND);
        } else if b == FESC {
            out.push(FESC);
            out.push(TFESC);
        } else {
            out.push(b);
        }
    }
    out.push(FEND);
    out
}

fn kiss_decode_into(buf: &[u8], frames: &mut Vec<Vec<u8>>) -> usize {
    let mut consumed = 0usize;
    let mut in_frame = false;
    let mut escaped = false;
    let mut current = Vec::new();
    let mut _port: u8 = 0;

    for &b in buf {
        consumed += 1;
        if b == FEND {
            if in_frame && !current.is_empty() {
                frames.push(current);
                current = Vec::new();
            }
            in_frame = true;
            escaped = false;
            _port = 0;
        } else if in_frame {
            if escaped {
                if b == TFEND {
                    current.push(FEND);
                } else if b == TFESC {
                    current.push(FESC);
                }
                escaped = false;
            } else if b == FESC {
                escaped = true;
            } else {
                current.push(b);
            }
        }
    }
    consumed
}

pub async fn start_bridge(state: Arc<AppState>) {
    let cfg = &state.config.rnode;
    if !cfg.enabled || cfg.serial_port.is_empty() {
        info!("RNode bridge disabled (no serial port configured)");
        return;
    }

    // Open serial port (blocking)
    let port_path = cfg.serial_port.clone();
    let baud = cfg.baud_rate;
    let room_name = cfg.bridge_room.clone();

    let mut port = match serialport::new(&port_path, baud)
        .timeout(Duration::from_millis(100))
        .open()
    {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to open RNode serial port {}: {}", port_path, e);
            return;
        }
    };

    info!("RNode serial port {} opened at {} baud", port_path, baud);

    // Channel for incoming frames: serial thread → tokio
    let (frame_tx, mut frame_rx) = mpsc::channel::<Vec<u8>>(256);

    // Spawn blocking read thread
    let read_port = port_path.clone();
    thread::spawn(move || {
        let mut buf = vec![0u8; 1024];
        let mut accum = Vec::new();
        let mut frames = Vec::new();
        loop {
            match port.read(&mut buf) {
                Ok(0) => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Ok(n) => {
                    accum.extend_from_slice(&buf[..n]);
                    let decoded = kiss_decode_into(&accum, &mut frames);
                    accum.drain(..decoded);
                    for frame in frames.drain(..) {
                        let _ = frame_tx.blocking_send(frame);
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // timeout, retry
                }
                Err(e) => {
                    error!("RNode serial read error on {}: {}", read_port, e);
                    break;
                }
            }
        }
    });

    // Channel for outgoing frames: WS → serial
    let (_write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(256);

    // Write task: send frames to serial
    let write_port = port_path.clone();
    tokio::spawn(async move {
        let mut port = match serialport::new(&write_port, baud)
            .timeout(Duration::from_millis(100))
            .open()
        {
            Ok(p) => p,
            Err(e) => {
                error!("Failed to open RNode write port: {}", e);
                return;
            }
        };
        while let Some(data) = write_rx.recv().await {
            let frame = kiss_encode(&data);
            if let Err(e) = port.write_all(&frame) {
                error!("RNode write error: {}", e);
                break;
            }
        }
    });

    // Create bridge room
    {
        let mut rooms = state.rooms.write().await;
        rooms.entry(room_name.clone()).or_insert_with(|| Room {
            clients: HashMap::new(),
            pw_hash: None,
            last_act: tokio::time::Instant::now(),
            challenges: HashMap::new(),
        });
    }

    // Store write channel for WS uplinks
    {
        let mut w = state.mesh_uplink.write().await;
        *w = None; // Clear MQTT uplink; we use a separate channel
    }
    // Actually, we need a way for WS clients to send to RNode.
    // For now, RNode is receive-only on the server side.
    // PWA sends via its own RNode (serial), server receives via its RNode.

    let state_room = state.clone();
    let room_keepalive = room_name.clone();
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(120)).await;
            let mut rooms = state_room.rooms.write().await;
            if let Some(room) = rooms.get_mut(&room_keepalive) {
                room.last_act = tokio::time::Instant::now();
            }
        }
    });

    info!("RNode bridge active, relaying to room '{}'", room_name);

    // Main loop: receive frames from serial, relay to WS room
    loop {
        match frame_rx.recv().await {
            Some(frame) => {
                if frame.is_empty() {
                    continue;
                }
                // Try to parse as JSON message from another piggPin node
                let txt = String::from_utf8_lossy(&frame).to_string();
                let mut rooms = state.rooms.write().await;
                let room = rooms.entry(room_name.clone()).or_insert_with(|| Room {
                    clients: HashMap::new(),
                    pw_hash: None,
                    last_act: tokio::time::Instant::now(),
                    challenges: HashMap::new(),
                });

                // Try to parse as JSON for type detection
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&txt) {
                    let msg_type = msg
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    let from = msg
                        .get("from")
                        .and_then(|f| f.as_u64())
                        .unwrap_or(0);
                    info!("RNode → room: {} from node {}", msg_type, from);
                }

                room.broadcast(&txt, "");
            }
            None => break,
        }
    }
}
