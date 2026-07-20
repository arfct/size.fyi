import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// NOTE: adapted from the brief's sketch (`defineWorkersConfig` +
// `poolOptions.workers`, the vitest-pool-workers v3 API). The installed
// version (0.18.x) targets Vitest 4's plugin-based custom-pool API instead:
// the pool is now a Vite plugin (`cloudflareTest`) rather than a
// `defineWorkersConfig`/`poolOptions.workers` config block. See the
// package's own `codemods/vitest-v3-to-v4` for the migration this mirrors.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['src/worker/**/*.test.ts'],
  },
});
