import { state } from './state.js';
import L from 'leaflet';
import { encrypt_pin_data, encrypt_raw_bytes, generate_uuid } from './core/pkg/e2e_core.js';
import * as DB from './db.js';

let _pinTitle = '';
let _pinNote = '';
let _pickerPinId = '';
let _currentLat = null;
let _currentLng = null;
let _schemaCreated = false;
let _customData = {};

export function init() {
    if (!isPicker()) return;
    window._pickMode = true;
    document.body.classList.add('picking');
    _pickerPinId = generate_uuid();

    window.addEventListener('message', (e) => {
        if (e.data?.type === 'komun:pin-details') {
            if (e.data.title !== undefined) _pinTitle = e.data.title;
            if (e.data.body !== undefined) _pinNote = e.data.body;
            if (e.data.kind !== undefined) _customData.kind = e.data.kind;
            if (e.data.category !== undefined) _customData.category = e.data.category;
            if (e.data.urgency !== undefined) _customData.urgency = e.data.urgency;
            if (e.data.contact !== undefined) _customData.contact = e.data.contact;
        }
        if (e.data?.type === 'komun:submit') {
            pushRelayPin();
        }
    });

    const enable = () => {
        if (state.currentSet && state.map && state.dek) {
            ensureSchema();
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

async function ensureSchema() {
    if (_schemaCreated) return;
    _schemaCreated = true;
    const gov = state.currentCommunity?.governance;
    if (!gov?.default_schema) return;
    const ds = gov.default_schema;
    try {
        const existing = await DB.getSchemas();
        if (existing.find(s => s.name === ds.name)) return;
        const schemaId = generate_uuid();
        await DB.saveSchema({ schema_id: schemaId, name: ds.name, fields: ds.fields || [] });
        state.schemas.push({ schema_id: schemaId, name: ds.name, fields: ds.fields });
        const layer = state.layers[0];
        if (layer) {
            layer.default_schema_id = schemaId;
            await DB.saveLayers(state.currentSet, state.layers);
        }
        console.log('[picker] schema created:', ds.name, schemaId);
    } catch (e) { console.warn('[picker] schema creation failed:', e.message); }
}

function pushRelayPin() {
    if (!_currentLat || !_currentLng) return;
    if (!state.dek || !state.currentSet || !state.signingPublicKey) {
        console.warn('[picker] push skipped: not ready');
        return;
    }
    try {
        const gov = state.currentCommunity?.governance || {};
        const kind = _customData.kind || 'resource';
        const emoji = (gov.post_kind_emoji || {})[kind] || '';
        const color = (gov.post_kind_color || {})[kind] || '#2563eb';
        const enc = encrypt_pin_data(_pinTitle, _pinNote, _currentLat, _currentLng, color, state.dek);
        const layer = state.layers[0];
        const pin = {
            pin_id: _pickerPinId, community_id: state.currentSet,
            ciphertext: enc.ciphertext, nonce: enc.nonce,
            author_pubkey: state.signingPublicKey, created_at: Date.now(),
            layer_id: layer?.layer_id || "", emoji,
            schema_id: layer?.default_schema_id || "",
        };
        const keys = Object.keys(_customData);
        if (keys.length > 0) {
            const json = new TextEncoder().encode(JSON.stringify(_customData));
            const cenc = encrypt_raw_bytes(json, state.dek);
            pin.custom_data = { ciphertext: cenc.ciphertext, nonce: cenc.nonce, mime_type: 'application/json' };
        }
        DB.savePin(pin).catch(e => console.warn('[picker] save failed:', e));
        window._relayPushDelta?.(state.currentSet, [pin], [], [], [], [], [], [], {});
        console.log('[picker] pin pushed to relay at', _currentLat, _currentLng, 'title:', _pinTitle);
    } catch (e) { console.warn('[picker] pin failed:', e.message); }
}

export function placePin(lat, lng) {
    if (!state.map || !window._pickMode) return;
    _currentLat = lat;
    _currentLng = lng;
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

    marker.on('dragend', () => {
        const pos = marker.getLatLng();
        _currentLat = pos.lat;
        _currentLng = pos.lng;
        marker.setTooltipContent(`${fmt(pos.lat)}, ${fmt(pos.lng)}`);
        try { window.parent.postMessage({ type: 'piggpin:location-picked', lat: pos.lat, lng: pos.lng }, '*'); } catch (_) {}
    });
    try { window.parent.postMessage({ type: 'piggpin:location-picked', lat, lng }, '*'); } catch (_) {}
}
