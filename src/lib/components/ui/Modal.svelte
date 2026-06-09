<script>
	let { onClose = () => {}, children } = $props();

	function handleClick(e) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<div class="modal-backdrop" onclick={handleClick} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }} role="dialog" tabindex="-1" autofocus>
	<div class="modal-responsive">
		{@render children?.()}
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.3);
		z-index: 3000; display: flex; align-items: center; justify-content: center;
	}
	.modal-responsive {
		background: var(--bg-card); padding: 20px; border-radius: 8px;
		min-width: 280px; width: min(88vw, 420px); box-shadow: 0 4px 20px rgba(0,0,0,0.3);
	}
</style>
