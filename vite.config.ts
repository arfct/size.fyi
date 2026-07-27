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
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        // Keep the three.js runtime in its own chunk, separate from our scene code. Both are
        // already lazy (Viewer imports the scene on mount), but splitting them means editing
        // scene.ts doesn't change the vendor hash, so returning visitors keep the cached copy of
        // by far the largest asset.
        //
        // Only three's own build output, NOT examples/jsm — GLTFLoader lives there and is
        // dynamically imported, so grouping it here would pull it back into the eager chunk.
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]build[\\/]/ }],
        },
      },
    },
    // The three vendor chunk alone is ~590 kB minified and can't be trimmed much further, so the
    // default 500 kB warning would fire on every build with nothing actionable behind it. Raised
    // just far enough to clear it — real growth past this is still worth a look.
    chunkSizeWarningLimit: 650,
  },
});
