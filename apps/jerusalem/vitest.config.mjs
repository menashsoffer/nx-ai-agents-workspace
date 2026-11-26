// Component tests (.tsx). Node runs .ts tests directly but not JSX, so these run in Vitest.
// Coverage (npm run coverage) covers every file in scope.json, tested or not.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import scope from './scripts/coverage/scope.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['web/src/**/*-test.tsx', 'web/tests/**/*-test.tsx'],
    environment: 'jsdom',
    // Keep jsdom workers within CI resources; parallel startup can starve router hydration.
    maxWorkers: 1,
    restoreMocks: true,
    setupFiles: ['web/tests/vitest-setup.ts'],
    coverage: {
      provider: 'v8',
      include: scope.include,
      exclude: scope.exclude,
      reporter: ['lcov', 'text-summary'],
      reportsDirectory: 'coverage/vitest',
    },
  },
});
