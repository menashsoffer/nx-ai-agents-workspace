// DESIGN.md 6.2: the button spec. Every button on the site is a Button or an IconButton.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Button, buttonClass } from '../button.tsx';
import { IconButton } from '../icon-button.tsx';

afterEach(() => {
  cleanup();
});

describe('Button (DESIGN.md 6.2)', () => {
  it('puts a decorative icon before the label and keeps the label as the name', () => {
    render(<Button icon="pencil">עריכה</Button>);
    const button = screen.getByRole('button', { name: 'עריכה' });
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(button.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
  it('gives a link the same classes as the button variant it looks like', () => {
    render(<Button variant="secondary">חזרה</Button>);
    const classes = buttonClass('secondary').split(' ');
    expect(screen.getByRole('button').className).toContain(classes[0]);
    expect(buttonClass()).not.toBe(buttonClass('quiet'));
  });
  it('keeps a plain button native: type button, saving state and keyboard', async () => {
    const run = vi.fn();
    const { rerender } = render(
      <Button variant="plain" onClick={run}>
        אריח
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'אריח' });
    expect(button.getAttribute('type')).toBe('button');
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(run).toHaveBeenCalledTimes(1);
    rerender(
      <Button variant="plain" onClick={run} pending>
        אריח
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'שומר…' }));
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('keeps its width while saving: the label stays, hidden, under "שומר…"', () => {
    render(
      <Button variant="secondary" icon="pencil" pending>
        דחיית המועמד
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'שומר…' });
    const held = screen.getByText('דחיית המועמד');
    expect(button.contains(held)).toBe(true);
    expect(held.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('IconButton (DESIGN.md 6.2)', () => {
  it('is named by its label and shows the short tip on hover, hidden from screen readers', async () => {
    render(<IconButton icon="trash" label="ביטול הבקשה: ניקיון" tip="ביטול הבקשה" />);
    const button = screen.getByRole('button', { name: 'ביטול הבקשה: ניקיון' });
    const tip = screen.getByText('ביטול הבקשה');
    expect(tip.getAttribute('aria-hidden')).toBe('true');
    expect(tip.hidden).toBe(true);
    await userEvent.hover(button);
    expect(tip.hidden).toBe(false);
    await userEvent.unhover(button);
    expect(tip.hidden).toBe(true);
  });
  it('shows the tip on keyboard focus and hides it on Escape or blur (WCAG 1.4.13)', async () => {
    render(
      <>
        <IconButton icon="pencil" label="עריכה" />
        <Button>אחר</Button>
      </>,
    );
    const tip = screen.getByText('עריכה');
    await userEvent.tab();
    expect(tip.hidden).toBe(false);
    await userEvent.keyboard('{Escape}');
    expect(tip.hidden).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'עריכה' }));
    expect(tip.hidden).toBe(false);
    await userEvent.tab();
    expect(tip.hidden).toBe(true);
  });
  it('runs its action on a press and shows a result note instead of the tip', async () => {
    const run = vi.fn();
    const { rerender } = render(<IconButton icon="copy" label="העתקת טלפון" onClick={run} />);
    await userEvent.click(screen.getByRole('button', { name: 'העתקת טלפון' }));
    expect(run).toHaveBeenCalledTimes(1);
    rerender(<IconButton icon="check" label="העתקת טלפון" note="הועתק" onClick={run} />);
    expect(screen.getByText('הועתק').hidden).toBe(false);
  });
  it('keeps its icon while saving and says so in its name', async () => {
    const run = vi.fn();
    render(<IconButton icon="refresh" label="בדיקה מחדש" pending onClick={run} />);
    const button = screen.getByRole('button', { name: 'שומר…' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.hasAttribute('data-pending')).toBe(true);
    await userEvent.click(button);
    expect(run).not.toHaveBeenCalled();
  });
});
