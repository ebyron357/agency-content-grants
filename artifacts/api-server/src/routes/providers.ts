import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { providerConfigsTable, modelConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { PROVIDERS, getProvidersStatus } from "../lib/ai/router";
import { requireAdmin } from "../middleware/requireAdmin";

const router: IRouter = Router();

// Provider status reads are available to any authenticated user (Settings UI).
// Connection tests (which spend AI credits) and the global model configuration
// are admin-only mutations.

const PROVIDER_META: Record<string, { displayName: string; description: string; envKey: string }> = {
  openai: { displayName: "OpenAI", description: "GPT-4o, GPT-4o mini, and other OpenAI models", envKey: "OPENAI_API_KEY" },
  anthropic: { displayName: "Anthropic", description: "Claude Opus, Sonnet, Haiku models", envKey: "ANTHROPIC_API_KEY" },
  gemini: { displayName: "Google Gemini", description: "Gemini 2.0 Flash, 1.5 Pro, and other Gemini models", envKey: "GEMINI_API_KEY" },
};

router.get("/providers", async (_req, res): Promise<void> => {
  const statuses = getProvidersStatus();
  const result = statuses.map((s) => {
    const meta = PROVIDER_META[s.name] ?? { displayName: s.name, description: "", envKey: "" };
    return {
      name: s.name,
      displayName: meta.displayName,
      description: meta.description,
      isConfigured: s.isConfigured,
      status: s.isConfigured ? "ready" : "unconfigured",
      availableModels: s.availableModels,
      lastTestedAt: null,
    };
  });
  res.json(result);
});

router.post("/providers", async (req, res): Promise<void> => {
  const { name, isEnabled, defaultModel } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const provider = PROVIDERS[name];
  if (!provider) { res.status(404).json({ error: "Unknown provider" }); return; }
  const meta = PROVIDER_META[name] ?? { displayName: name, description: "", envKey: "" };
  res.json({
    name,
    displayName: meta.displayName,
    description: meta.description,
    isConfigured: provider.isConfigured(),
    status: provider.isConfigured() ? "ready" : "unconfigured",
    availableModels: provider.listModels(),
    lastTestedAt: null,
  });
});

router.post("/providers/:name/test", requireAdmin, async (req, res): Promise<void> => {
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const provider = PROVIDERS[name];
  if (!provider) { res.status(404).json({ error: "Unknown provider" }); return; }
  const result = await provider.testConnection();
  res.json({ provider: name, ...result });
});

router.get("/model-config", async (_req, res): Promise<void> => {
  const rows = await db.select().from(modelConfigTable).limit(1);
  if (!rows[0]) {
    // Auto-create singleton
    const [config] = await db.insert(modelConfigTable).values({ id: "singleton" }).returning();
    res.json(config);
    return;
  }
  res.json(rows[0]);
});

router.patch("/model-config", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db.select().from(modelConfigTable).limit(1);
  if (!rows[0]) {
    await db.insert(modelConfigTable).values({ id: "singleton" });
  }
  const [config] = await db.update(modelConfigTable).set(req.body).where(eq(modelConfigTable.id, "singleton")).returning();
  res.json(config);
});

export default router;
