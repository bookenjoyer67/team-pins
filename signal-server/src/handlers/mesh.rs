use tracing::warn;

use super::HandlerContext;

pub async fn handle_mesh_uplink(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    if let Some(payload) = v.get("payload").and_then(|p| p.as_str()) {
        let to = v.get("to").and_then(|t| t.as_u64());
        let mqtt_payload = serde_json::json!({"p": payload, "to": to}).to_string();
        let tx = ctx.state.mesh_uplink.read().await;
        if let Some(ref tx) = *tx {
            if tx.send(mqtt_payload).await.is_err() {
                warn!("[relay] mesh_uplink TX failed, channel closed");
            }
        }
    }
}

pub async fn handle_mesh_uplink_presence(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let tx = ctx.state.mesh_uplink.read().await;
    if let Some(ref tx) = *tx {
        if tx.send(v.to_string()).await.is_err() {
            warn!("[relay] mesh_uplink_position TX failed, channel closed");
        }
    }
}
