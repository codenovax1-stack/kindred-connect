/**
 * The robots' own AI runtime. This is the ONLY model provider the running app
 * uses. It never touches Lovable AI / the Lovable AI Gateway and never falls
 * back to it — if it is not configured, requests fail with a clear message.
 *
 * Server-side configuration (environment secrets, never sent to the browser):
 *   ROBOT_AI_API_KEY   required — the external provider's API key
 *   ROBOT_AI_BASE_URL  optional — OpenAI-compatible base URL
 *                      (default https://openrouter.ai/api/v1)
 *   ROBOT_AI_MODEL     optional — model id, or a comma-separated preference list
 *   ROBOT_AI_PROVIDER  optional — display label for the UI indicator
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const RUNTIME_NOT_CONNECTED =
  "AI runtime not connected. Add the ROBOT_AI_API_KEY secret (plus optional ROBOT_AI_BASE_URL / ROBOT_AI_MODEL) to give the robots their own AI provider. This app never uses Lovable AI at runtime, so there is no fallback.";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODELS = "openrouter/free";

export interface RuntimeConfig {
  configured: boolean;
  provider: string;
  baseUrl: string;
  models: string[];
  apiKey: string | undefined;
}

export function readRuntimeConfig(): RuntimeConfig {
  const apiKey = process.env["ROBOT_AI_API_KEY"];
  const baseUrl = (process.env["ROBOT_AI_BASE_URL"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const models = (process.env["ROBOT_AI_MODEL"] ?? DEFAULT_MODELS)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  let provider = process.env["ROBOT_AI_PROVIDER"];
  if (!provider) {
    try {
      provider = new URL(baseUrl).hostname.replace(/^www\./, "");
    } catch {
      provider = "external";
    }
  }
  return { configured: Boolean(apiKey), provider, baseUrl, models, apiKey };
}

/** Public (no-secret) view of the runtime, safe to send to the browser. */
export function runtimeStatus() {
  const cfg = readRuntimeConfig();
  return {
    connected: cfg.configured,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.models[0] ?? null,
    usesLovableAi: false,
    message: cfg.configured ? null : RUNTIME_NOT_CONNECTED,
  };
}

export function createRobotModel(cfg: RuntimeConfig, index = 0) {
  if (!cfg.configured || !cfg.apiKey) throw new Error(RUNTIME_NOT_CONNECTED);
  const provider = createOpenAICompatible({
    name: cfg.provider,
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
    headers: {
      "HTTP-Referer": "https://moinsprivate.lovable.app",
      "X-Title": "AI Robot Command Center",
    },
  });
  const model = cfg.models[index] ?? cfg.models[0]!;
  return provider.chatModel(model);
}
