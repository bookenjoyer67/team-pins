import { state } from './state.js';
import L from 'leaflet';
import { encrypt_pin_data, generate_uuid } from './core/pkg/e2e_core.js';
import * as DB from './db.js';

export function init() {
    if (!isPicker()) return;
    window._pickMode = true;
    document.body.classList.add('picking');
    const enable = () => {
        if (state.currentSet && state.map && state.dek) {
            placePin(state.map.getCenter().lat, state.map.getCenter().lng);
        } else {
            setTimeout(enable, 500);
        }
    };
    setTimeout(enable, 1000);
}

function isPicker() {
    try { return new URLSearchParams(location.search).get('picker') === '1'; }
    catch (_) { return false; }
}

export function placePin(lat, lng) {
    if (!state.map || !window._pickMode) return;
    const icon = L.divIcon({
        className: 'pick-marker',
        html: '<div style="width:24px;height:24px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:grab;"></div>',
        iconSize: [24, 24], iconAnchor: [12, 12],
    });
    const marker = L.marker([lat, lng], { draggable: true, icon }).addTo(state.map);
    const fmt = (v) => v.toFixed(5);
    marker.bindTooltip(`${fmt(lat)}, ${fmt(lng)}`, {
        permanent: true, direction: 'top', className: 'pick-tooltip'
    }).openTooltip();
    marker.on('dragend', () => {
        const pos = marker.getLatLng();
        marker.setTooltipContent(`${fmt(pos.lat)}, ${fmt(pos.lng)}`);
        try { window.parent.postMessage({ type: 'piggpin:location-picked', lat: pos.lat, lng: pos.lng }, '*'); } catch (_) {}
    });
    try { window.parent.postMessage({ type: 'piggpin:location-picked', lat, lng }, '*'); } catch (_) {}

    if (state.dek && state.currentSet && state.signingPublicKey) {
        try {
            const enc = encrypt_pin_data("Pin", "", lat, lng, "#2563eb", state.dek);
            const pin = {
                pin_id: generate_uuid(), community_id: state.currentSet,
                ciphertext: enc.ciphertext, nonce: enc.nonce,
                author_pubkey: state.signingPublicKey, created_at: Date.now(),
                layer_id: state.layers[0]?.layer_id || "", emoji: "",
            };
            DB.savePin(pin).catch(e => console.warn('[picker] save failed:', e));
            window._relayPushDelta?.(state.currentSet, [pin], [], [], [], [], [], [], {});
        } catch (e) { console.warn('[picker] pin failed:', e.message); }
    }
}
