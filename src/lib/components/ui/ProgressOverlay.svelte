<script>
	import { t } from '$lib/i18n/i18n.js';

	let { title = '', percent = 0, label = 'Preparing...' } = $props();
</script>

<div class="progress-backdrop">
	<div class="progress-card">
		<h3 class="title">{title}</h3>
		<div class="bar-track">
			<div class="bar-fill" style="width:{percent}%"></div>
		</div>
		<p class="desc">{label}</p>
	</div>
</div>

<style>
	.progress-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.3);
		z-index: 3000; display: flex; align-items: center; justify-content: center;
	}
	.progress-card {
		background: var(--bg-card); padding: 24px; border-radius: 8px;
		min-width: 340px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
	}
	.title { margin: 0 0 16px; font-size: 15px; color: var(--text); }
	.bar-track {
		background: var(--border-light); border-radius: 4px;
		height: 8px; overflow: hidden; margin-bottom: 8px;
	}
	.bar-fill {
		background: #2563eb; height: 100%; transition: width 0.3s ease;
	}
	.desc { font-size: 12px; color: var(--text-dim); margin: 0; text-align: center; }
</style>
