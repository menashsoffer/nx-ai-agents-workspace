import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { OfflineBanner } from '../offline-banner.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('shows the bar while the browser is offline and removes it when the connection returns', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  render(<OfflineBanner />);
  const region = screen.getByRole('status');
  expect(region.textContent).toBe('');
  online.mockReturnValue(false);
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
  expect(region.textContent).toMatch(/אין חיבור לאינטרנט/u);
  online.mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
  expect(region.textContent).toBe('');
});
