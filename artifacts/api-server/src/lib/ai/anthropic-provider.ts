import type { AIProvider, ChatMessage, GenerationOptions, GenerationResult } from "./types";

const ANTHROPIC_MODELS = [
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-3-5",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
];

export class AnthropicProvider implements AIProvider {
  name = "anthropic";

  isConfigured(): boolean {
    return !!(process.env.ANTHROPIC_API_KEY);
  }

  listModels(): string[] {
    return ANTHROPIC_MODELS;
  }

  async testConnection(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    if (!this.isConfigured()) {
      return { success: false, message: "ANTHROPIC_API_KEY is not set. Add it to Replit Secrets.", latencyMs: 0 };
    }
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-3-5",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        return { success: false, message: `Anthropic API error: ${res.status} ${res.statusText}`, latencyMs: Date.now() - start };
      }
      return { success: true, message: "Connected to Anthropic successfully.", latencyMs: Date.now() - start };
    } catch (e) {
      return { success: false, message: `Connection failed: ${(e as Error).message}`, latencyMs: Date.now() - start };
    }
  }

  async generate(messages: ChatMessage[], options: GenerationOptions = {}): Promise<GenerationResult> {
    if (!this.isConfigured()) throw new Error("ANTHROPIC_API_KEY is not configured. Add it to Replit Secrets.");

    const model = options.model ?? "claude-sonnet-4-5";
    const start = Date.now();

    const systemMsg = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 4000,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    const latencyMs = Date.now() - start;
    const usage = data.usage ?? {};

    const costPerInputToken = 0.000003;
    const costPerOutputToken = 0.000015;
    const estimatedCostUsd = (usage.input_tokens ?? 0) * costPerInputToken + (usage.output_tokens ?? 0) * costPerOutputToken;

    return {
      content: data.content?.[0]?.text ?? "",
      provider: "anthropic",
      model,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      latencyMs,
      estimatedCostUsd,
    };
  }
}

export const anthropicProvider = new AnthropicProvider();
