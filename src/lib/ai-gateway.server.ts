import { createOpenAI } from "@ai-sdk/openai";

const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export function createLovableAiGatewayRunIdFetch(initialRunId?: string | undefined) {
  let runId = initialRunId;
  const wrapped: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (runId) headers.set(RUN_ID_HEADER, runId);
    const response = await fetch(input as RequestInfo, { ...init, headers });
    const returned = response.headers.get(RUN_ID_HEADER);
    if (returned) runId = returned;
    return response;
  };
  return {
    fetch: wrapped,
    get runId() {
      return runId;
    },
  };
}

export function getLovableAiGatewayRunId(request: Request): string | undefined {
  return request.headers.get(RUN_ID_HEADER) ?? undefined;
}

/** Responses-API provider for openai/* models on the Lovable AI Gateway. */
export function createGateway(apiKey: string, runIdFetch: { fetch: typeof fetch }) {
  return createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });
}

export const CHAT_MODEL = "openai/gpt-6-astra";

export const RESPONSES_PROVIDER_OPTIONS = {
  openai: {
    store: false,
    include: ["reasoning.encrypted_content"],
    forceReasoning: true,
    reasoningEffort: "low",
    reasoningSummary: "auto",
  },
} as const;
