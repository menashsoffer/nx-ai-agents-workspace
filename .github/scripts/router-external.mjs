// External router brain (stub). Used when vars.ROUTER_MODE == 'external'
// or vars.ROUTER_SHADOW == 'true'; runs in router.yml's `brain` job, which
// holds no write token.
//
// Intended brain: Jev by TypeSafe AI, a "System One" decision model that
// returns typed choices with calibrated probabilities
// (https://typesafe.ai/blog/introducing-system-one-models-and-jev), called
// through OpenRouter:
//
//   POST https://openrouter.ai/api/alpha/decisions
//   model: typesafe/jev-1.13
//   state: the outcome note + trimmed route history (both are data)
//   one `choice` question whose options are exactly `allowed`
//
// and mapped back to `{ target, confidence }`. Whatever it returns, the
// router accepts it only if `target` is in `allowed` and `confidence` is at
// least 0.8, and clampDecision (caps + hard gates) still applies.
//
// Not wired yet: no API key or secret exists for it, and this stub makes no
// network call. Returning null makes the router fall back to its rules.

/**
 * @param {{ outcome: object, history: { outcomes: object[], routes: object[] }, allowed: string[] }} input
 * @returns {Promise<{ target: string, confidence: number } | null>}
 */
export async function decideExternal({ outcome, history, allowed }) {
  void outcome;
  void history;
  void allowed;
  return null;
}
