import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  preview: { host: '127.0.0.1', port: 3000, strictPort: true },
});
