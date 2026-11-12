import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], server: { watch: { ignored: ['**/src/laporan.json'] }, proxy: { '/api': 'http://127.0.0.1:8787' } } });
