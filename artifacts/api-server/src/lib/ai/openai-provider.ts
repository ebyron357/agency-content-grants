import type { AIProvider, ChatMessage, GenerationOptions, GenerationResult } from "./types";

const OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
];

export class OpenAIProvider implements AIProvider {
  name = "openai";

  isConfigured(): boolean {
    return !!(process.env.OPENAI_API_KEY);
  }

  listModels(): string[] {
    return OPENAI_MODELS;
  }

  async testConnection(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    if (!this.isConfigured()) {
      return { success: false, message: "OPENAI_API_KEY is not set. Add it to Replit Secrets.", latencyMs: 0 };
    }
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });
      if (!res.ok) {
        return { success: false, message: `OpenAI API error: ${res.status} ${res.statusText}`, latencyMs: Date.now() - start };
      }
      return { success: true, message: "Connected to OpenAI successfully.", latencyMs: Date.now() - start };
    } catch (e) {
      return { success: false, message: `Connection failed: ${(e as Error).message}`, latencyMs: Date.now() - start };
    }
  }

  async generate(messages: ChatMessage[], options: GenerationOptions = {}): Promise<GenerationResult> {
    if (!this.isConfigured()) throw new Error("OPENAI_API_KEY is not configured. Add it to Replit Secrets.");

    const model = options.model ?? "gpt-4o";
    const start = Date.now();

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 4000,
        temperature: options.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    const latencyMs = Date.now() - start;
    const usage = data.usage ?? {};

    // Cost estimates (approximate, USD per token)
    const costPerInputToken = model.includes("gpt-4o-mini") ? 0.00000015 : 0.000005;
    const costPerOutputToken = model.includes("gpt-4o-mini") ? 0.0000006 : 0.000015;
    const estimatedCostUsd = (usage.prompt_tokens ?? 0) * costPerInputToken + (usage.completion_tokens ?? 0) * costPerOutputToken;

    return {
      content: data.choices?.[0]?.message?.content ?? "",
      provider: "openai",
      model,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      latencyMs,
      estimatedCostUsd,
    };
  }
}

export const openAIProvider = new OpenAIProvider();
