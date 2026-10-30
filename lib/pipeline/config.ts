/**
 * Configuration and model selection.
 * Only the five WTQ-allowed models can be used; anything else stops the program.
 */
import "dotenv/config";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const ALLOWED_MODELS: Record<string, string> = {
  "claude-haiku-4-5": "anthropic",
  "gemini-3.5-flash-lite": "google",
  "gemini-3.1-flash-lite": "google",
  "gpt-4.1-mini": "openai",
  "gpt-5-mini": "openai",
};

const env = (k: string, d?: string) => (process.env[k]?.trim() || d) as string;
/** Positive integer from .env, or the default if missing/invalid. */
const int = (k: string, d: number) => {
  const n = Number.parseInt(env(k, String(d)), 10);
  return Number.isFinite(n) && n >= 1 ? n : d;
};

export const config = {
  provider: env("MODEL_PROVIDER", "anthropic").toLowerCase(),
  modelName: env("MODEL_NAME", "claude-haiku-4-5"),
  /** Independent extraction passes per bill; fields are decided by majority vote. */
  extractRuns: int("EXTRACT_RUNS", 3),
  /** Bills processed in parallel. Lower this if you hit rate limits. */
  concurrency: int("CONCURRENCY", 2),
  /** Longest image edge sent to the model, in pixels. */
  maxImageEdge: int("MAX_IMAGE_EDGE", 1568),
  // Serverless hosts (Vercel) only allow writes under /tmp.
  cacheDir: env("CACHE_DIR", process.env.VERCEL ? "/tmp/bill-decoder/cache" : ".cache"),
};

function apiKey(): string {
  const specific =
    config.provider === "anthropic" ? "ANTHROPIC_API_KEY" : config.provider === "google" ? "GOOGLE_GENERATIVE_AI_API_KEY" : "OPENAI_API_KEY";
  const key = env("API_KEY") || env(specific);
  if (!key || key.includes("your-api-key")) {
    throw new Error(`No API key found. Set API_KEY in .env (see .env.example).`);
  }
  return key;
}

/** True when an API key is set (the web app falls back to saved sample results otherwise). */
export function isModelConfigured(): boolean {
  try {
    apiKey();
    return Boolean(ALLOWED_MODELS[config.modelName]);
  } catch {
    return false;
  }
}

let cached: LanguageModel | null = null;

/** Tests only: inject a mock model. */
export function setModelForTests(m: LanguageModel) {
  cached = m;
}

export function getModel(): LanguageModel {
  if (cached) return cached;
  const expected = ALLOWED_MODELS[config.modelName];
  if (!expected) {
    throw new Error(
      `Model "${config.modelName}" is not allowed in WTQ. Use one of: ${Object.keys(ALLOWED_MODELS).join(", ")}`,
    );
  }
  if (expected !== config.provider) {
    throw new Error(`Model "${config.modelName}" belongs to provider "${expected}", but MODEL_PROVIDER is "${config.provider}".`);
  }
  const key = apiKey();
  if (config.provider === "anthropic") cached = createAnthropic({ apiKey: key })(config.modelName);
  else if (config.provider === "google") cached = createGoogleGenerativeAI({ apiKey: key })(config.modelName);
  else cached = createOpenAI({ apiKey: key })(config.modelName);
  return cached;
}
