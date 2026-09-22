# vite-config

Shared Vite/Vitest configuration for every app in `apps/`. An app's whole
`vite.config.mts` is:

```ts
import { defineConfig } from 'vite';
import { defineAppConfig } from '@starter/vite-config';

export default defineConfig(defineAppConfig(import.meta.dirname, { port: 4200 }));
```

It wires React, Tailwind v4, Vitest (jsdom), the GitHub Pages base path
(`BASE_PATH` env var, default `/`) and a `404.html` SPA fallback for deep links.
Change behaviour for all apps here; don't fork it per app.
