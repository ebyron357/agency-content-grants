import { demoPublishProvider } from "./demo-provider";
import { typefullyPublishProvider } from "./typefully-provider";
import type { PublishProvider } from "./types";

export const PUBLISH_PROVIDERS: Record<string, PublishProvider> = {
  demo: demoPublishProvider,
  typefully: typefullyPublishProvider,
};

export function isValidPublishProvider(name: string): boolean {
  return name in PUBLISH_PROVIDERS;
}

/**
 * Look up the adapter for a destination's chosen provider. Deliberately does
 * NOT fall back to another provider when the requested one is unconfigured —
 * a destination explicitly set up for "typefully" must fail loudly if
 * TYPEFULLY_API_KEY is missing, never silently publish through "demo" instead.
 */
export function getPublishProvider(providerName: string): PublishProvider {
  const provider = PUBLISH_PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown publish provider: ${providerName}`);
  return provider;
}

export function getPublishProvidersStatus() {
  return Object.values(PUBLISH_PROVIDERS).map((p) => ({
    name: p.name,
    isConfigured: p.isConfigured(),
  }));
}
