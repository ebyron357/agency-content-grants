import type { AIProvider, ChatMessage, GenerationOptions, GenerationResult } from "./types";

const GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
];

export class GeminiProvider implements AIProvider {
  name = "gemini";

  isConfigured(): boolean {
    return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
  }

  private getKey(): string {
    return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? "";
  }

  listModels(): string[] {
    return GEMINI_MODELS;
  }

  async testConnection(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    if (!this.isConfigured()) {
      return { success: false, message: "GEMINI_API_KEY is not set. Add it to Replit Secrets.", latencyMs: 0 };
    }
    try {
      const model = "gemini-2.0-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.getKey()}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 5 } }),
      });
      if (!res.ok) {
        return { success: false, message: `Gemini API error: ${res.status} ${res.statusText}`, latencyMs: Date.now() - start };
      }
      return { success: true, message: "Connected to Google Gemini successfully.", latencyMs: Date.now() - start };
    } catch (e) {
      return { success: false, message: `Connection failed: ${(e as Error).message}`, latencyMs: Date.now() - start };
    }
  }

  async generate(messages: ChatMessage[], options: GenerationOptions = {}): Promise<GenerationResult> {
    if (!this.isConfigured()) throw new Error("GEMINI_API_KEY is not configured. Add it to Replit Secrets.");

    const model = options.model ?? "gemini-2.0-flash";
    const start = Date.now();

    const systemMsg = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const contents = userMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.getKey()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
        contents,
        generationConfig: { maxOutputTokens: options.maxTokens ?? 4000, temperature: options.temperature ?? 0.7 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    const latencyMs = Date.now() - start;
    const usage = data.usageMetadata ?? {};

    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      provider: "gemini",
      model,
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      latencyMs,
      estimatedCostUsd: 0,
    };
  }
}

export const geminiProvider = new GeminiProvider();
