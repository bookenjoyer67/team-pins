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
        html: '<svg width="28" height="40" viewBox="0 0 28 40" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));cursor:grab;"><path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.27 21.73 0 14 0z" fill="#2563eb" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="6" fill="#fff"/></svg>',
        iconSize: [28, 40], iconAnchor: [14, 40], popupAnchor: [0, -40],
    });
    const marker = L.marker([lat, lng], { draggable: true, icon }).addTo(state.map);
    const fmt = (v) => v.toFixed(5);
    marker.bindTooltip(`${fmt(lat)}, ${fmt(lng)}`, {
        permanent: true, direction: 'top', className: 'pick-tooltip'
    }).openTooltip();

    const pushRelayPin = (posLat, posLng) => {
        if (state.dek && state.currentSet && state.signingPublicKey) {
            try {
                const enc = encrypt_pin_data("", "", posLat, posLng, "#2563eb", state.dek);
                const pin = {
                    pin_id: generate_uuid(), community_id: state.currentSet,
                    ciphertext: enc.ciphertext, nonce: enc.nonce,
                    author_pubkey: state.signingPublicKey, created_at: Date.now(),
                    layer_id: state.layers[0]?.layer_id || "", emoji: "",
                };
                DB.savePin(pin).catch(e => console.warn('[picker] save failed:', e));
                window._relayPushDelta?.(state.currentSet, [pin], [], [], [], [], [], [], {});
                console.log('[picker] pin pushed to relay at', posLat, posLng);
            } catch (e) { console.warn('[picker] pin failed:', e.message); }
        }
    };

    marker.on('dragend', () => {
        const pos = marker.getLatLng();
        marker.setTooltipContent(`${fmt(pos.lat)}, ${fmt(pos.lng)}`);
        try { window.parent.postMessage({ type: 'piggpin:location-picked', lat: pos.lat, lng: pos.lng }, '*'); } catch (_) {}
        pushRelayPin(pos.lat, pos.lng);
    });
    try { window.parent.postMessage({ type: 'piggpin:location-picked', lat, lng }, '*'); } catch (_) {}
}
