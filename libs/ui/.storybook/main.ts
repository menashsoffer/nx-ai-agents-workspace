import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: [
    '../src/docs/**/*.mdx',
    '../src/lib/**/*.@(mdx|stories.@(js|jsx|ts|tsx))',
  ],
  addons: [getAbsolutePath('@storybook/addon-docs')],
  framework: {
    name: getAbsolutePath('@storybook/react-vite'),
    options: {
      builder: {
        viteConfigPath: 'vite.config.mts',
      },
    },
  },
};

function getAbsolutePath(value: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

export default config;
