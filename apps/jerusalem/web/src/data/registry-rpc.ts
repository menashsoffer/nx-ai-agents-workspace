// The calls added on 25.11 (home screen, registry verification, awarding a request), kept
// apart so rpc.ts stays in size.
export interface RegistryRpc {
  home_overview: Record<string, never>;
  registry_reviews: Record<string, never>;
  registry_review: { version: string };
  set_registry_validity: { version: string; valid_until: string | null };
  decide_membership: { membership: string; approve: boolean; note: string | null };
  award_engagement_request: { request: string; approach: string; note: string | null };
}

declare module '../database.types.ts' {
  interface PublicFunctions {
    home_overview: { Args: RegistryRpc['home_overview']; Returns: unknown };
    registry_reviews: { Args: RegistryRpc['registry_reviews']; Returns: unknown };
    registry_review: { Args: RegistryRpc['registry_review']; Returns: unknown };
    set_registry_validity: { Args: RegistryRpc['set_registry_validity']; Returns: null };
    decide_membership: { Args: RegistryRpc['decide_membership']; Returns: null };
    award_engagement_request: { Args: RegistryRpc['award_engagement_request']; Returns: null };
  }
}
