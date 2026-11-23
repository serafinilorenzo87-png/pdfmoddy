import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Tauri expects the dev server on a fixed port and not to clear the screen
// (so Rust compile errors stay visible while the frontend reloads).
export default defineConfig({
    plugins: [sveltekit()],
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: '127.0.0.1'
    },
    envPrefix: ['VITE_', 'TAURI_']
});
