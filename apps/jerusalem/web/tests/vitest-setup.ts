// Coverage on CI makes the first render of a lazy screen slow; wait longer than the 1s default.
import { afterEach } from 'vitest';
import { configure } from '@testing-library/react';
import { clearScreenData } from '../src/data/screen-data.ts';

configure({ asyncUtilTimeout: 4000 });

// Screen data lives in memory for the whole page, like a tab; each test is a fresh tab.
afterEach(() => {
  clearScreenData();
});
