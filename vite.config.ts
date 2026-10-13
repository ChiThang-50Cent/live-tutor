import { cloudflare } from '@cloudflare/vite-plugin';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `--mode lan` (npm run dev:lan): self-signed HTTPS on the LAN so a phone can use the mic
// (getUserMedia requires a secure context; plain http://192.168.x.x is not one).
export default defineConfig(({ mode }) => ({
  plugins: [react(), cloudflare(), ...(mode === 'lan' ? [basicSsl()] : [])],
  server: mode === 'lan' ? { host: true } : undefined,
  build: {
    // Keep the AudioWorklet module a real file: data: URLs break addModule() under CSP / some browsers.
    assetsInlineLimit: (file) => (file.endsWith('.worklet.js') ? false : undefined),
  },
}));
