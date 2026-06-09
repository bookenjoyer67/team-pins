import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({ fallback: 'index.html', pages: 'dist', assets: 'dist' }),
		files: { appTemplate: 'src/app.html', assets: 'public' },
		alias: {
			$stores: 'src/lib/stores',
			$engine: 'src/lib/engine',
			$i18n: 'src/lib/i18n',
			$components: 'src/lib/components'
		}
	}
};
