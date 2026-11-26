// The full zod build, for screens that load lazily. The first screen uses zod/mini in rpc.ts
// to stay inside the first-load budget; both share one configuration (set in rpc.ts).
export { z } from 'zod';
