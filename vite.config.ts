import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for WebXR on the headset (anything but localhost).
// host: true exposes the server on the LAN / hotspot so the Quest can reach it.
export default defineConfig({
  // Relative asset paths so the build works both locally and under /stillshot/ on GitHub Pages.
  base: './',
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022' },
});
