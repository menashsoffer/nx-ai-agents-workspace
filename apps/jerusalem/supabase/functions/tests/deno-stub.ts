// A stand-in for the Deno globals the Edge Functions read when they start. Import it before
// the functions so their start-up code runs under Node; each Deno.serve handler is kept.
// The network is replaced too: every request answers 503, so no test reaches a server.
export const served: ((request: Request) => Promise<Response>)[] = [];

const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'public',
  SUPABASE_SERVICE_ROLE_KEY: 'secret',
};

Object.assign(globalThis, {
  Deno: {
    env: { get: (name: string) => ENV[name] },
    serve: (handler: (request: Request) => Promise<Response>) => {
      served.push(handler);
    },
  },
});

export const requests: string[] = [];
globalThis.fetch = (input) => {
  requests.push(input instanceof Request ? input.url : input.toString());
  return Promise.resolve(new Response(null, { status: 503 }));
};
