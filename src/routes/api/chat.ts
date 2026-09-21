import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import {
  CHAT_MODEL,
  RESPONSES_PROVIDER_OPTIONS,
  createGateway,
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
} from "@/lib/ai-gateway.server";
import { readPage, webSearch } from "@/lib/web-tools.server";
import { SHARED_FOUNDATION } from "@/lib/robots";

interface RobotPayload {
  id: string;
  name: string;
  role: string;
  description?: string;
  personality?: string;
  instructions?: string;
  capabilities?: { web?: boolean; browser?: boolean; memory?: boolean; delegate?: boolean };
  requireConfirmation?: boolean;
}

function systemPrompt(robot: RobotPayload, memory: string[], roster: RobotPayload[]): string {
  const team = roster
    .filter((r) => r.id !== robot.id)
    .map((r) => `- ${r.name} (${r.role}): ${r.description ?? ""}`)
    .join("\n");
  return [
    SHARED_FOUNDATION,
    `# Your identity\nName: ${robot.name}\nPrimary role: ${robot.role}\nDescription: ${robot.description ?? ""}\nPersonality: ${robot.personality ?? ""}`,
    robot.instructions ? `# Operator instructions\n${robot.instructions}` : "",
    memory.length ? `# Your long-term memory\n${memory.map((m) => `- ${m}`).join("\n")}` : "",
    team ? `# Your team\n${team}` : "",
    robot.capabilities?.delegate
      ? "You can delegate sub-tasks with delegate_to_robot. Delegate in parallel where sensible, then merge results and attribute each finding to the robot that produced it."
      : "",
    "The local desktop agent bridge (Gmail accounts, files, computer actions) is not connected yet. If a request needs it, say so clearly instead of fabricating results.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildTools(
  robot: RobotPayload,
  roster: RobotPayload[],
  makeModel: () => ReturnType<ReturnType<typeof createGateway>["responses"]>,
) {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  if (robot.capabilities?.web !== false) {
    tools["web_search"] = tool({
      description: "Search the live web. Returns titles, URLs and snippets.",
      inputSchema: z.object({ query: z.string().describe("Search query") }),
      execute: async ({ query }) => ({ query, results: await webSearch(query) }),
    });
    tools["read_page"] = tool({
      description:
        "Open a URL and read its text content plus outgoing links. Use it to navigate between pages and follow links.",
      inputSchema: z.object({ url: z.string().describe("Absolute URL to open") }),
      execute: async ({ url }) => readPage(url),
    });
  }

  if (robot.capabilities?.memory !== false) {
    tools["save_memory"] = tool({
      description: "Store a durable fact in your long-term memory for future conversations.",
      inputSchema: z.object({ note: z.string().describe("The fact to remember, one sentence") }),
      execute: async ({ note }) => ({ saved: true, note }),
    });
  }

  if (robot.capabilities?.delegate) {
    const names = roster.filter((r) => r.id !== robot.id).map((r) => r.name);
    tools["delegate_to_robot"] = tool({
      description: `Delegate a sub-task to a specialist robot. Available: ${names.join(", ")}.`,
      inputSchema: z.object({
        robot: z.string().describe("Robot name, e.g. ZYRON"),
        task: z.string().describe("Self-contained task description with all needed context"),
      }),
      execute: async ({ robot: target, task }) => {
        const worker = roster.find(
          (r) => r.name.toLowerCase() === target.trim().toLowerCase() && r.id !== robot.id,
        );
        if (!worker) return { robot: target, error: `No robot named ${target} exists.` };
        const result = streamText({
          model: makeModel(),
          system: `${systemPrompt(worker, [], roster)}\n\nYou were delegated this task by ${robot.name}. Answer thoroughly and cite URLs.`,
          prompt: task,
          tools: buildTools({ ...worker, capabilities: { ...worker.capabilities, delegate: false } }, roster, makeModel),
          stopWhen: stepCountIs(20),
          providerOptions: RESPONSES_PROVIDER_OPTIONS,
        });
        return { robot: worker.name, task, result: await result.text };
      },
    });
  }

  return tools;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "AI is not configured for this app." }, { status: 500 });
        }

        const body = (await request.json()) as {
          messages: UIMessage[];
          robot: RobotPayload;
          roster?: RobotPayload[];
          memory?: string[];
        };
        if (!body?.robot || !Array.isArray(body.messages)) {
          return Response.json({ error: "Invalid request." }, { status: 400 });
        }

        const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
        const gateway = createGateway(apiKey, runIdFetch);
        const makeModel = () => gateway.responses(CHAT_MODEL);
        const roster = body.roster ?? [];

        try {
          const result = streamText({
            model: makeModel(),
            system: systemPrompt(body.robot, body.memory ?? [], roster),
            messages: convertToModelMessages(body.messages),
            tools: buildTools(body.robot, roster, makeModel),
            stopWhen: stepCountIs(50),
            providerOptions: RESPONSES_PROVIDER_OPTIONS,
            abortSignal: request.signal,
          });
          return result.toUIMessageStreamResponse({
            originalMessages: body.messages,
            sendReasoning: true,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return new Response("Cancelled", { status: 499 });
          }
          const message = error instanceof Error ? error.message : String(error);
          console.error("chat route failed", error);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
