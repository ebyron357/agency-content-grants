import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderTimeoutError,
  providerFetch,
  providerHttpError,
} from "./providerRequest";

describe("provider request safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_PROVIDER_TIMEOUT_MS;
  });

  it("adds an explicit timeout signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    await providerFetch("OpenAI", "https://example.test");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("turns timeout failures into a deterministic safe error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(new DOMException("secret body", "TimeoutError")),
    );
    await expect(
      providerFetch("Gemini", "https://example.test"),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("does not include provider response bodies in HTTP errors", () => {
    expect(providerHttpError("Anthropic", 401).message).toBe(
      "Anthropic API error (401)",
    );
  });
});
