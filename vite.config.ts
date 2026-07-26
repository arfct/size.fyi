import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

function devApi(): Plugin {
  return {
    name: 'dev-api-devices',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/devices', async (_req, res) => {
        const { readFile } = await import('node:fs/promises');
        res.setHeader('content-type', 'application/json');
        res.end(await readFile('public/devices.json'));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  build: { outDir: 'dist' },
});
