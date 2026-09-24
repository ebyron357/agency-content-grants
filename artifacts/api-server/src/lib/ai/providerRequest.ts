import { logger } from "../logger";

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export class ProviderTimeoutError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} request timed out`);
    this.name = "ProviderTimeoutError";
  }
}

export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const configured = Number(process.env.AI_PROVIDER_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_PROVIDER_TIMEOUT_MS;
  const startedAt = Date.now();

  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    logger.error(
      {
        err: error,
        provider,
        timeoutMs,
        latencyMs: Date.now() - startedAt,
        timedOut,
      },
      "AI provider request failed",
    );
    if (timedOut) throw new ProviderTimeoutError(provider);
    throw new Error(`${provider} request failed`);
  }
}

export function providerHttpError(provider: string, status: number): Error {
  logger.warn({ provider, status }, "AI provider returned an error response");
  return new Error(`${provider} API error (${status})`);
}
