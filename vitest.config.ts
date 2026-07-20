import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/{app,shared,three}/**/*.test.{ts,tsx}'],
    setupFiles: ['src/app/__tests__/setup.ts'],
  },
});
