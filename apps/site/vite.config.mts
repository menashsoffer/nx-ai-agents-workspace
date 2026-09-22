import { defineConfig } from 'vite';
import { defineAppConfig } from '@starter/vite-config';

export default defineConfig(
  defineAppConfig(import.meta.dirname, { port: 4200 }),
);
