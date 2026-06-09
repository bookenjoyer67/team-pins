<script>
	import Modal from '../ui/Modal.svelte';
	import { cancelDialog } from '$lib/stores/dialogs.js';
	import { t } from '$lib/i18n/i18n.js';
	import { state } from '$lib/state.js';
	import { COLORS } from '../../../../helpers.js';
	import { layers, schemas } from '$stores/layers.js';

	let { lat = 0, lng = 0, pinId = '', editing = false } = $props();

	let title = '';
	let note = '';
	let geocoding = false;
	let color = '#2563eb';
	let emoji = '';
	let _renderTick = 0;

	function handleColor(c) { color = c; }

	async function fillAddress() {
		if (geocoding) return;
		geocoding = true;
		try {
			const { reverseGeocode } = await import('../../../../map.js');
			const address = await reverseGeocode(lat, lng);
			if (address) {
				const current = note.trim();
				note = current ? current + '\n' + address : address;
			}
		} catch (e) {}
		geocoding = false;
	}
	let layerId = '';
	let schemaId = '';
	let timeFrom = '';
	let timeUntil = '';
	let anonymous = false;
	let file = null;
	let recordBlob = null;
	let loaded = false;
	let recType = null;
	let recStatus = 'idle';
	let recTimerText = '0:00';
	let recPreview = null; // DOM reference
	let recStream = null;
	let recRecorder = null;
	let recChunks = [];
	let recTimer = null;
	let recStartTime = 0;
	let cameraFacing = 'environment';
	let schemaFieldsHtml = '';

	let gov = {};
	let showAnon = false;
	let showTTL = false;
	let ttlInfo = '';

	import { onMount, onDestroy } from 'svelte';
	onMount(async () => {
		// Subscribe to layers/schemas changes — force re-render on change
		const unsubLayers = layers?.subscribe?.(() => { _renderTick = Date.now(); });
		const unsubSchemas = schemas?.subscribe?.(() => { _renderTick = Date.now(); });

		gov = state.currentCommunity?.governance || {};
		showAnon = gov.anonymous_posting === 'allowed' || gov.anonymous_posting === 'members_only';
		showTTL = !!gov.ttl_enabled;
		if (showTTL) ttlInfo = `TTL: ${gov.ttl_base_mins} min base + ${gov.ttl_vote_mins} min/vote`;
		if (editing && pinId) {
			try {
				const { getPin } = await import('../../../../db.js');
				const row = await getPin(pinId);
				if (row && state.dek) {
				const { decrypt_pin_data } = await import('../../../../core/pkg/e2e_core.js');
				const data = decrypt_pin_data(row.ciphertext, row.nonce, state.dek);
					title = data.title || '';
					note = data.note || '';
					color = row.color || '#2563eb';
					emoji = data.emoji || '';
					layerId = row.layer_id || '';
					schemaId = row.schema_id || '';
					timeFrom = data.valid_from || '';
					timeUntil = data.valid_until || '';
				}
			} catch (e) { console.error('[PinForm] edit load error:', e); }
		} else {
			layerId = state.activeLayerId || '';
			schemaId = state.layers.find(l => l.layer_id === state.activeLayerId)?.default_schema_id || '';
		}
		// Render schema fields after initial data loaded
		setTimeout(() => loadSchemaFields(), 200);
		loaded = true;
	});

	async function loadSchemaFields() {
		const schema = schemaId ? state.schemas.find(s => s.schema_id === schemaId) : null;
		if (!schema || !schema.fields?.length) {
			schemaFieldsHtml = '';
			return;
		}
		const { escapeHtml } = await import('../../../../dialogs.js');
		let h = `<div class="sf-wrap" style="border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:4px;"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">📋 ${escapeHtml(schema.name)}</div>`;
		for (const f of schema.fields) {
			const key = f.key;
			if (f.type === 'choice' && f.options) {
				h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><select name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">${f.options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select></div>`;
			} else if (f.type === 'boolean') {
				h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><select name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;"><option value="true">true</option><option value="false">false</option></select></div>`;
			} else if (f.type === 'date') {
				h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><input type="date" name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
			} else if (f.type === 'time') {
				h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><input type="time" name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
			} else if (f.type === 'number') {
				h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><input type="number" name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
			} else {
				h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><input type="text" name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
			}
		}
		h += '</div>';
		schemaFieldsHtml = h;
	}

	onDestroy(() => cleanupRecorder());

	function cleanupRecorder() {
		if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
		if (recRecorder && recRecorder.state === 'recording') recRecorder.stop();
		recRecorder = null;
		recChunks = [];
		if (recTimer) { clearInterval(recTimer); recTimer = null; }
		recType = null;
		recStatus = 'idle';
		recordBlob = null;
	}

	function formatTime(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

	function toast(msg, clr) { window._svelteToast?.(msg, clr, 2000); }

	async function startRecording(type) {
		if (recStream || recRecorder) return;
		recType = type;
		try {
			const constraints = type === 'video'
				? { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: cameraFacing }, audio: true }
				: { audio: true };
			recStream = await navigator.mediaDevices.getUserMedia(constraints);
			const mime = type === 'video'
				? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm')
				: 'audio/webm';
			recChunks = [];
			recRecorder = new MediaRecorder(recStream, { mimeType: mime, videoBitsPerSecond: 1500000 });
			if (type === 'video' && recPreview) {
				recPreview.srcObject = recStream;
				recPreview.style.display = 'block';
			}
			recRecorder.ondataavailable = (e) => { if (e.data.size > 0) recChunks.push(e.data); };
			recRecorder.onstop = () => {
				if (recPreview) { recPreview.srcObject = null; recPreview.style.display = 'none'; }
				recStream?.getTracks().forEach(t => t.stop());
				recStream = null;
				recRecorder = null;
				if (recTimer) { clearInterval(recTimer); recTimer = null; }
				const blob = new Blob(recChunks, { type: mime });
				recordBlob = blob;
				recStatus = 'captured';
			};
			recRecorder.start(1000);
			recStartTime = Date.now();
			recStatus = 'recording';
			recTimer = setInterval(() => {
				const elapsed = Date.now() - recStartTime;
				recTimerText = formatTime(elapsed);
				const max = type === 'video' ? 120000 : 300000;
				if (elapsed >= max && recRecorder?.state === 'recording') {
					recRecorder.stop();
					toast('Recording limit reached', '#f97316');
				}
			}, 500);
		} catch (err) {
			toast(type === 'video' ? 'Camera/mic access denied' : 'Microphone access denied', '#dc2626');
			recType = null;
		}
	}

	async function startSnap() {
		if (recStream || recRecorder || recordBlob) return;
		recType = 'snap';
		try {
			recStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: cameraFacing } });
			if (recPreview) { recPreview.srcObject = recStream; recPreview.style.display = 'block'; }
			recStatus = 'snapping';
		} catch (err) {
			toast('Camera access denied', '#dc2626');
			recType = null;
		}
	}

	function captureSnap() {
		if (!recPreview || !recStream) return;
		const canvas = document.createElement('canvas');
		canvas.width = recPreview.videoWidth || 640;
		canvas.height = recPreview.videoHeight || 480;
		const ctx = canvas.getContext('2d');
		ctx.drawImage(recPreview, 0, 0, canvas.width, canvas.height);
		canvas.toBlob((blob) => {
			if (!blob) { toast('Snapshot failed', '#dc2626'); cancelSnap(); return; }
			recordBlob = blob;
			cancelSnap();
			recStatus = 'captured';
		}, 'image/jpeg', 0.85);
	}

	function cancelSnap() {
		if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
		if (recPreview) { recPreview.srcObject = null; recPreview.style.display = 'none'; }
		recStatus = 'idle';
		recType = null;
	}

	async function switchCamera() {
		if (!recStream || !recType) return;
		const wasRecording = recStatus === 'recording';
		const wasType = recType;
		recRecorder?.stop();
		recStream.getTracks().forEach(t => t.stop());
		if (recTimer) { clearInterval(recTimer); recTimer = null; }
		recStream = null; recRecorder = null; recChunks = [];
		cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
		if (wasRecording) {
			if (wasType === 'video') startRecording('video');
		} else {
			startSnap();
		}
	}

	function stopRecording() {
		if (recRecorder?.state === 'recording') recRecorder.stop();
	}

	function discardRecording() {
		recordBlob = null;
		recStatus = 'idle';
		recType = null;
	}

	let saving = false;

	function save() {
		if (saving) return;
		saving = true;
		saveAsync().finally(() => { saving = false; });
	}

	async function saveAsync() {
		const { savePin, updatePin, compressMedia } = await import('../../../../map.js');
		const { encrypt_raw_bytes } = await import('../../../../core/pkg/e2e_core.js');

		let media = null;
		const sourceFile = file || (recordBlob ? new File([recordBlob], `recording-${Date.now()}.webm`, { type: recordBlob.type }) : null);

		if (sourceFile) {
			const { showProgress } = await import('$lib/stores/dialogs.js');
			const prog = showProgress('Processing media...');
			try {
				prog.update(5, 'Compressing...');
				const c = await compressMedia(sourceFile, (pct) => prog.update(5 + Math.round(pct * 0.75), 'Compressing...'));
				prog.update(80, 'Encrypting...');
				const enc = encrypt_raw_bytes(new Uint8Array(c.buffer), state.dek);
				media = { type: c.type, name: c.name, ciphertext: enc.ciphertext, nonce: enc.nonce };
				prog.done();
			} catch(e) {
				prog.done();
				window._svelteToast?.('Media failed: ' + e.message, '#dc2626');
				return;
			}
		}

		// Collect schema field data
		const { collectSchemaData } = await import('../../../../map-schemas.js');
		const schemaData = collectSchemaData('schema-fields');

		cleanupRecorder();

		if (editing) {
			await updatePin(pinId, title || 'Untitled', note, color, media, emoji, layerId, schemaId, schemaData, timeFrom, timeUntil);
		} else {
			await savePin(lat, lng, title || 'Untitled', note, color, media, emoji, layerId, schemaId, schemaData, timeFrom, timeUntil, anonymous);
		}

		cancelDialog();
	}

	function close() {
		cleanupRecorder();
		cancelDialog();
	}
</script>

<Modal onClose={close}>
	{#snippet children()}
		<h3 class="h">{editing ? t('editPin') : t('newPin')}</h3>
			<input class="inp" bind:value={title} placeholder={t('title')} autofocus />
			<div class="ta-wrap">
			<textarea class="inp ta" bind:value={note} placeholder={t('description')} rows="3"></textarea>
			<button class="geo-btn" onclick={fillAddress} disabled={geocoding} title={t('reverseGeocode') || 'Fill address'}>{geocoding ? '⏳' : '📍'}</button>
		</div>

			<div class="label">{t('color')}</div>
			{#key color}
			<div class="colors">
				{#each COLORS as c}
					<span class="swatch" style="background:{c}; border:2px solid {color === c ? 'var(--text)' : 'transparent'};" onclick={() => handleColor(c)}></span>
				{/each}
				<span class="swatch hue" style="border:2px solid {COLORS.includes(color) ? 'transparent' : 'var(--text)'};" onclick={() => {
					const picker = document.createElement('input');
					picker.type = 'color'; picker.value = color;
					picker.style.cssText = 'position:absolute;width:0;height:0;opacity:0;';
					document.body.appendChild(picker);
					picker.oninput = () => { handleColor(picker.value); };
					picker.onblur = () => picker.remove();
					picker.click();
				}}></span>
				<input type="text" class="hex-inp" value={color} placeholder="#hex" oninput={(e) => { const v = e.target.value; if (/^#[0-9a-fA-F]{6}$/.test(v)) handleColor(v); }} />
			</div>
			{/key}

			<div class="label">{t('emoji') || 'Emoji'}</div>
			<div class="emoji-row">
				<input class="emoji-inp" bind:value={emoji} placeholder="😊" maxlength="2" />
			</div>

			<div class="label">{t('layer') || 'Layer'}</div>
		{#key _renderTick}
			<select class="inp" value={layerId} oninput={(e) => {
				layerId = e.target.value;
				const l = state.layers.find(l => l.layer_id === layerId);
				if (l?.default_schema_id) {
					schemaId = l.default_schema_id;
					loadSchemaFields();
				}
			}}>
				{#each state.layers as l}
					<option value={l.layer_id}>{l.name}</option>
				{/each}
			</select>

			<div class="label">{t('schemas') || 'Schema'}</div>
			<select class="inp" value={schemaId} oninput={(e) => { schemaId = e.target.value; loadSchemaFields(); }}>
				<option value="">none</option>
				{#each state.schemas as s}
					<option value={s.schema_id}>{s.name}</option>
				{/each}
			</select>
		{/key}
			<div id="schema-fields">{@html schemaFieldsHtml}</div>

			<!-- Recording controls (only in create mode, not edit) -->
			{#if !editing && typeof MediaRecorder !== 'undefined'}
				<div class="label">{t('photoVideo')}</div>
				<video bind:this={recPreview} class="rec-preview" muted autoplay playsinline></video>
				<div class="rec-bar">
					{#if recStatus === 'idle' || recStatus === 'captured'}
						<button class="rec-btn v" onclick={() => startRecording('video')}>📹 Record Video</button>
						<button class="rec-btn a" onclick={() => startRecording('audio')}>🎤 Record Audio</button>
						<button class="rec-btn s" onclick={startSnap}>📷 Snap Photo</button>
					{/if}
					{#if recStatus === 'recording'}
						<span class="rec-status">⏺ Recording... {recTimerText}
							{#if recType === 'video'}<button class="rec-small" onclick={switchCamera}>🔄</button>{/if}
						</span>
						<button class="rec-stop" onclick={stopRecording}>⏹ Stop</button>
					{/if}
					{#if recStatus === 'snapping'}
						<button class="rec-btn s" onclick={captureSnap}>📸 Capture</button>
						<button class="rec-small" onclick={switchCamera}>🔄</button>
						<button class="rec-cancel" onclick={cancelSnap}>Cancel</button>
					{/if}
					{#if recStatus === 'captured'}
						<span class="rec-done">✅ Recorded</span>
						<button class="rec-cancel" onclick={discardRecording}>Discard</button>
					{/if}
				</div>
			{/if}

			<!-- File input (fallback for edit mode or when MediaRecorder unavailable) -->
			{#if editing || typeof MediaRecorder === 'undefined'}
				<div class="label">{t('photoVideo')}</div>
				<input type="file" class="inp" accept="image/*,video/*,audio/*" onchange={(e) => file = e.target.files[0]} />
			{/if}

			<div class="label">{t('timeFrom')}</div>
			<input class="inp" bind:value={timeFrom} placeholder="YYYY" />
			<div class="label">{t('timeTo')}</div>
			<input class="inp" bind:value={timeUntil} placeholder="YYYY" />

			{#if showAnon}
				<label class="check"><input type="checkbox" bind:checked={anonymous} /> Post anonymously</label>
			{/if}
			{#if showTTL}
				<div class="ttl">{ttlInfo}</div>
			{/if}

			<div class="actions">
				<button class="btn-cancel" onclick={close}>{t('cancel')}</button>
				<button class="btn-save" onclick={save}>{t('save')}</button>
			</div>
	{/snippet}
</Modal>

<style>
	.h { margin: 0 0 12px; font-size: 15px; color: var(--text); }
	.inp { width: 100%; padding: 6px; margin-bottom: 8px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-input); color: var(--text); font-size: 13px; }
	.ta { resize: vertical; }
	.ta-wrap { position: relative; width: 100%; margin-bottom: 8px; }
	.ta-wrap .ta { width: 100%; padding-right: 32px; box-sizing: border-box; }
	.geo-btn { position: absolute; top: 6px; right: 4px; width: 24px; height: 24px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-input); cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; padding: 0; }
	.label { font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
	.colors { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; align-items: center; }
	.swatch { display: inline-block; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; }
	.swatch.hue { background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); background-size: 140% 140%; background-position: center; }
	.hex-inp { width: 62px; height: 24px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-input); color: var(--text); font-size: 11px; padding: 0 4px; box-sizing: border-box; font-family: monospace; }
	.swatch.active { border-color: var(--blue); box-shadow: 0 0 0 2px var(--bg-card), 0 0 0 4px var(--blue); }
	.emoji-row { display: flex; gap: 4px; margin-bottom: 8px; }
	.emoji-inp { width: 56px; height: 42px; text-align: center; font-size: 28px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-input); color: var(--text); padding: 0; box-sizing: border-box; }
	.check { display: flex; align-items: center; gap: 4px; font-size: 12px; margin-bottom: 8px; color: var(--text-dim); }
	.ttl { font-size: 10px; color: var(--text-dim); margin: 4px 0; }
	.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
	.btn-cancel { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
	.btn-save { padding: 6px 14px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
	.rec-preview { display: none; width: 100%; max-height: 200px; margin-bottom: 8px; border-radius: 4px; background: #000; }
	.rec-bar { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
	.rec-btn { padding: 4px 10px; border: 1px solid; border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg-card); }
	.rec-btn.v { border-color: #dc2626; color: #dc2626; }
	.rec-btn.a { border-color: #2563eb; color: #2563eb; }
	.rec-btn.s { border-color: #7c3aed; color: #7c3aed; }
	.rec-status { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
	.rec-stop { border: none; background: #dc2626; color: white; border-radius: 3px; cursor: pointer; font-size: 11px; padding: 2px 8px; }
	.rec-small { padding: 2px 6px; border: 1px solid var(--border); background: var(--bg-input); border-radius: 3px; cursor: pointer; font-size: 11px; }
	.rec-cancel { padding: 2px 6px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-dim); border-radius: 3px; cursor: pointer; font-size: 11px; }
	.rec-done { font-size: 12px; color: #16a34a; }
</style>
