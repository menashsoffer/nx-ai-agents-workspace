import { StrictMode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ScreenError } from '../screen-error.tsx';
import { RouteError } from '../route-error.tsx';
import { setTelemetryReporter } from '../../lib/telemetry.ts';
import type { TelemetryEvent } from '../../lib/vitals-model.ts';
afterEach(() => {
  cleanup();
  setTelemetryReporter(() => undefined);
});
for (const [Component, boundary, heading] of [
  [ScreenError, 'route', 'לא ניתן להציג את המסך'],
  [RouteError, 'root', 'משהו השתבש'],
] as const) {
  it(`reports the ${boundary} error boundary without serializing private error text`, async () => {
    const events: TelemetryEvent[] = [];
    setTelemetryReporter((e) => {
      events.push(e);
    });
    const error = Object.assign(
      new Error('secret@example.test /supplier/private?access_token=secret'),
      { status: 503 },
    );
    const router = createMemoryRouter(
      [{ id: 'root', path: '/', element: <p>page</p>, errorElement: <Component /> }],
      { hydrationData: { errors: { root: error } } },
    );
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    expect(await screen.findByRole('heading', { name: heading })).toBeDefined();
    await waitFor(() => {
      expect(events).toEqual([{ name: 'error', error_code: 'http_5xx', boundary, kind: 'system' }]);
    });
    expect(JSON.stringify(events)).not.toMatch(/secret|supplier|access_token|stack|message/);
    // Private error text never reaches the screen either.
    expect(document.body.textContent).not.toMatch(/secret/);
  });
}
