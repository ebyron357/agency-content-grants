import { openAIProvider } from "./openai-provider";
import { anthropicProvider } from "./anthropic-provider";
import { geminiProvider } from "./gemini-provider";
import { demoProvider } from "./demo";
import type { AIProvider, ChatMessage, GenerationOptions, GenerationResult } from "./types";
import { db } from "@workspace/db";
import { modelConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const PROVIDERS: Record<string, AIProvider> = {
  openai: openAIProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  demo: demoProvider,
};

export type PipelineStage =
  | "planning"
  | "research"
  | "outline"
  | "writing"
  | "editing"
  | "verification"
  | "evaluation"
  | "utility";

async function getModelForStage(stage: PipelineStage): Promise<string | null> {
  try {
    const [config] = await db.select().from(modelConfigTable).where(eq(modelConfigTable.id, "singleton")).limit(1);
    if (!config) return null;
    const map: Record<PipelineStage, string | null> = {
      planning: config.planningModel,
      research: config.researchModel,
      outline: config.outlineModel,
      writing: config.writingModel,
      editing: config.editingModel,
      verification: config.verificationModel,
      evaluation: config.evaluationModel,
      utility: config.utilityModel,
    };
    return map[stage] ?? null;
  } catch {
    return null;
  }
}

function parseProviderFromModel(model: string): string {
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "gemini";
  return "openai";
}

export function getActiveProvider(): AIProvider {
  if (openAIProvider.isConfigured()) return openAIProvider;
  if (anthropicProvider.isConfigured()) return anthropicProvider;
  if (geminiProvider.isConfigured()) return geminiProvider;
  return demoProvider;
}

export async function generateForStage(
  stage: PipelineStage,
  messages: ChatMessage[],
  options: GenerationOptions = {}
): Promise<GenerationResult> {
  const configuredModel = await getModelForStage(stage);

  if (configuredModel) {
    const providerName = parseProviderFromModel(configuredModel);
    const provider = PROVIDERS[providerName];
    if (provider?.isConfigured()) {
      return provider.generate(messages, { ...options, model: configuredModel });
    }
  }

  const active = getActiveProvider();
  return active.generate(messages, options);
}

export function getProvidersStatus() {
  return Object.values(PROVIDERS)
    .filter((p) => p.name !== "demo")
    .map((p) => ({
      name: p.name,
      isConfigured: p.isConfigured(),
      availableModels: p.listModels(),
    }));
}
