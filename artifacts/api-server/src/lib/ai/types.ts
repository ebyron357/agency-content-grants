export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerationResult {
  content: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

export interface AIProvider {
  name: string;
  isConfigured(): boolean;
  generate(messages: ChatMessage[], options?: GenerationOptions): Promise<GenerationResult>;
  listModels(): string[];
  testConnection(): Promise<{ success: boolean; message: string; latencyMs: number }>;
}

export interface GenerationOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
