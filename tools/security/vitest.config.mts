import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/security',
  test: {
    name: 'security',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.mjs'],
    reporters: ['default'],
  },
}));
