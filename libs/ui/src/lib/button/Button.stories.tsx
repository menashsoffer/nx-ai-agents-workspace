import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

const meta = {
  component: Button,
  title: 'Components/Button',
  args: { children: 'לחצו כאן' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: { variant: 'secondary' },
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <span aria-hidden>←</span>
        המשך
      </>
    ),
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
