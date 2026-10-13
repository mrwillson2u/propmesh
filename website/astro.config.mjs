// @ts-check
// The PropMesh docs site — user documentation, the browser flasher and a
// "try it" copy of the console. Published to GitHub Pages by
// .github/workflows/site.yml. Board pages are generated from
// boards/*.yaml (scripts/gen-boards.mjs runs before dev and build).
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://mrwillson2u.github.io',
	base: '/propmesh',
	integrations: [
		starlight({
			title: 'PropMesh',
			description: 'Wireless control for Halloween and holiday props. Inexpensive ESP32 boards, one show, no wires between them.',
			logo: { src: './src/assets/logo.svg' },
			favicon: '/favicon.svg',
			customCss: ['./src/styles/theme.css'],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mrwillson2u/propmesh' }],
			editLink: { baseUrl: 'https://github.com/mrwillson2u/propmesh/edit/dev/website/' },
			lastUpdated: true,
			sidebar: [
				{ label: 'Start here', items: [
					{ label: 'What is PropMesh?', slug: 'start/what-is-propmesh' },
					{ label: 'Try it in your browser', slug: 'start/try-it' },
					{ label: 'Your first scare in 15 minutes', slug: 'start/first-scare' },
					{ label: 'Install the firmware', slug: 'start/flash' },
				] },
				{ label: 'Boards', items: [{ autogenerate: { directory: 'boards' } }] },
				{ label: 'Wiring props', items: [{ autogenerate: { directory: 'props' } }] },
				{ label: 'Building a show', items: [{ autogenerate: { directory: 'show' } }] },
				{ label: 'Help', items: [{ autogenerate: { directory: 'help' } }] },
				{ label: 'Contribute', slug: 'contribute' },
			],
		}),
	],
});
