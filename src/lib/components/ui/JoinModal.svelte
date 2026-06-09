<script>
	import Modal from './Modal.svelte';
	import { cancelDialog } from '$lib/stores/dialogs.js';
	import { t } from '$lib/i18n/i18n.js';
	import { state } from '$lib/state.js';

	let { onConnect = () => {} } = $props();

	function scan() {
		cancelDialog();
		import('../../../../dialogs.js').then(d => {
			d.showQRScanDialog(t('scanHostQR'), async (data) => {
				await handleCode(data);
			}, () => window._showJoinModal?.());
		});
	}

	function paste() {
		cancelDialog();
		import('../../../../dialogs.js').then(d => {
			d.showPeerPaste(t('pasteHostOffer'), async (data) => {
				await handleCode(data);
			});
		});
	}

	async function handleCode(raw) {
		let code = raw;
		if (raw.includes('#join=')) {
			try {
				let b64 = raw.split('#join=')[1].split('&')[0];
				b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
				while (b64.length % 4) b64 += '=';
				code = atob(b64);
			} catch (_) {}
		}
		try {
			const Peer = await import('../../../../peer.js');
			const { generate_qr_svg } = await import('../../../../core/pkg/e2e_core.js');
			const { setId, compact } = await Peer.acceptOffer(code, state.user.id, state.displayName);
			window._pendingJoinSet = true;
			const aqr = generate_qr_svg(compact);
			import('../../../../dialogs.js').then(d => d.showQRAnswerDialog('Send Back', compact, aqr));
			if (setId) {
				const Map = await import('../../../../map.js');
				await Map.switchSet(setId);
			}
		} catch (_) {
			import('../../../../dialogs.js').then(d => d.alertDialog('Failed to connect'));
		}
	}
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		<h3 class="h">{t('joinPeer')}</h3>
		<p class="desc">{t('joinPeerDescription')}</p>
		<div class="actions">
			<button class="btn-scan" onclick={scan}>{t('scanHostQRBtn')}</button>
			<button class="btn-paste" onclick={paste}>{t('pasteCodeBtn')}</button>
			<button class="btn-cancel" onclick={() => cancelDialog()}>{t('cancel')}</button>
		</div>
	{/snippet}
</Modal>

<style>
	.h { margin: 0 0 12px; font-size: 15px; color: var(--text); }
	.desc { font-size: 13px; color: var(--text-dim); margin: 0 0 16px; }
	.actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-scan { padding: 6px 14px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
	.btn-paste { padding: 6px 14px; border: 1px solid #2563eb; background: var(--bg-card); color: #2563eb; border-radius: 4px; cursor: pointer; }
	.btn-cancel { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
</style>
