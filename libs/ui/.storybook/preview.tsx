import type { Decorator, Preview } from '@storybook/react-vite';
import '../src/styles.css';

type Direction = 'rtl' | 'ltr';

/** Mirrors the per-app `<html dir lang>` so every story is checked both ways. */
const withDirection: Decorator = (Story, context) => {
  const dir = (context.globals['dir'] as Direction) ?? 'rtl';

  document.documentElement.dir = dir;
  document.documentElement.lang = dir === 'rtl' ? 'he' : 'en';

  return <Story />;
};

const preview: Preview = {
  decorators: [withDirection],
  globalTypes: {
    dir: {
      description: 'Text direction',
      toolbar: {
        title: 'Direction',
        icon: 'transfer',
        items: [
          { value: 'rtl', title: 'RTL (עברית)' },
          { value: 'ltr', title: 'LTR' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { dir: 'rtl' },
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default preview;
