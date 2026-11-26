// Speed measurements and usage tracking, loaded after the first screen so neither counts
// toward the initial bundle. The vitals observers read buffered entries, so starting late
// still sees the page load (web-monitoring-he.md).
import type { EventBatcher } from '../lib/tracker.ts';
import { observeVitals } from '../lib/vitals.ts';
import type { TelemetryEvent } from '../lib/vitals-model.ts';
import { SITE_VERSION, withDetails } from '../lib/error-details.ts';
import { setTelemetryReporter } from '../lib/telemetry.ts';
import { screenOf, startUsage, type UsageRouter } from './usage.ts';

interface Monitoring {
  win: Window;
  router: UsageRouter;
  /** The entry's telemetry batcher; its class also batches usage events. */
  telemetry: EventBatcher<TelemetryEvent>;
}

export function startMonitoring({ win, router, telemetry }: Monitoring): void {
  const device = win.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  // Errors are sent with what failed and where (error-details-spec-he.md section 6).
  setTelemetryReporter((event, error) => {
    const context = { screen: screenOf(router.state), device, version: SITE_VERSION } as const;
    telemetry.add(event.name === 'error' ? withDetails(event, error, context) : event);
  });
  observeVitals(
    win,
    (event) => {
      telemetry.add(event);
    },
    {
      flush: () => {
        telemetry.flush();
      },
    },
  );
  startUsage(win, router, telemetry.constructor as typeof EventBatcher);
}
