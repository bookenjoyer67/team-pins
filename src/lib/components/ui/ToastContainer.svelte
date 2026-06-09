<script>
	// Toast notification manager — listens for toast events
	import { onMount } from 'svelte';

	let toasts = [];
	let nextId = 0;
	const ACTIVE = new Map();

	function addToast(msg, color = '#dc2626', duration = 2000, undoAction = null) {
		const id = nextId++;
		const toast = { id, msg, color, duration, undoAction };
		toasts.push(toast);
		toasts = toasts; // trigger reactivity

		ACTIVE.set(id, setTimeout(() => {
			ACTIVE.delete(id);
			removeToast(id);
		}, duration));

		return id;
	}

	function removeToast(id) {
		clearTimeout(ACTIVE.get(id));
		ACTIVE.delete(id);
		toasts = toasts.filter(t => t.id !== id);
	}

	function doUndo(id, undoAction) {
		undoAction();
		removeToast(id);
	}

	onMount(() => {
		// Override global toast function so engine modules can use it
		window._svelteToast = addToast;
	});
</script>

<div class="toast-container">
	{#each toasts as toast (toast.id)}
		<div class="toast" style="background:{toast.color}">
			<span>{toast.msg}</span>
			{#if toast.undoAction}
				<button class="toast-undo" onclick={() => doUndo(toast.id, toast.undoAction)}>Undo</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toast-container {
		position: fixed;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 3000;
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: center;
	}
	.toast {
		color: white;
		padding: 10px 20px;
		border-radius: 6px;
		font-size: 14px;
		box-shadow: 0 2px 10px rgba(0,0,0,0.3);
		display: flex;
		align-items: center;
		gap: 10px;
		animation: toast-in 0.2s ease;
	}
	.toast-undo {
		padding: 3px 10px;
		border: 1px solid rgba(255,255,255,0.4);
		background: rgba(255,255,255,0.15);
		color: white;
		border-radius: 3px;
		cursor: pointer;
		font-size: 12px;
		white-space: nowrap;
	}
	@keyframes toast-in {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
