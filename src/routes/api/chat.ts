import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  RUNTIME_NOT_CONNECTED,
  createRobotModel,
  readRuntimeConfig,
  type RuntimeConfig,
} from "@/lib/robot-runtime.server";
import { buildProjectTools, defaultRepo, githubAvailable } from "@/lib/github-tools.server";
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
    githubAvailable()
      ? [
          "# Project and code access",
          `You have real tools over the operator's GitHub repositories${defaultRepo() ? ` (default repository: ${defaultRepo()})` : ""}: list_repos, list_files, search_code, read_file, git_status, git_diff, check_status, propose_change, commit_change, delete_file, open_pull_request.`,
          "Never claim you changed code unless a tool returned a commit. Workflow for any change: read the relevant files, then propose_change to show a diff, then wait for the operator to approve commit_change. delete_file, commit_change and open_pull_request pause for the operator's approval before running — that is expected, do not work around it.",
          "check_status only reports automated check runs that already exist in the repository; it does not run a build locally.",
        ].join("\n")
      : "Project/code tools are unavailable because no GitHub connection is configured.",
    "The local desktop agent bridge (Gmail accounts, files, computer actions) is not connected yet. If a request needs it, say so clearly instead of fabricating results.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildTools(robot: RobotPayload, roster: RobotPayload[], cfg: RuntimeConfig): ToolSet {
  const tools: ToolSet = {};

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

  Object.assign(tools, buildProjectTools());

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
        // Delegates run on the same external runtime. Read-only tools only:
        // anything needing approval stays with the robot the operator is
        // talking to, so approval is never bypassed inside a delegation.
        const workerTools = buildTools(
          { ...worker, capabilities: { ...worker.capabilities, delegate: false } },
          roster,
          cfg,
        );
        for (const key of ["commit_change", "delete_file", "open_pull_request"]) {
          delete workerTools[key];
        }
        try {
          const result = streamText({
            model: createRobotModel(cfg),
            system: `${systemPrompt(worker, [], roster)}\n\nYou were delegated this task by ${robot.name}. Answer thoroughly and cite URLs or file paths.`,
            prompt: task,
            tools: workerTools,
            stopWhen: stepCountIs(20),
          });
          return { robot: worker.name, task, result: await result.text };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { robot: worker.name, task, error: message };
        }
      },
    });
  }

  return tools;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // The robots run ONLY on the operator's own AI runtime. There is no
        // Lovable AI call and no fallback to it anywhere in this path.
        const cfg = readRuntimeConfig();
        if (!cfg.configured) {
          return Response.json({ error: RUNTIME_NOT_CONNECTED }, { status: 503 });
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

        const roster = body.roster ?? [];

        try {
          const result = streamText({
            model: createRobotModel(cfg),
            system: systemPrompt(body.robot, body.memory ?? [], roster),
            messages: await convertToModelMessages(body.messages),
            tools: buildTools(body.robot, roster, cfg),
            stopWhen: stepCountIs(50),
            abortSignal: request.signal,
          });
          return result.toUIMessageStreamResponse({
            originalMessages: body.messages,
            sendReasoning: true,
            // Never mask the real failure behind "An error occurred."
            onError: (error) => {
              const message = error instanceof Error ? error.message : String(error);
              console.error("robot runtime stream failed", error);
              return `${cfg.provider} (${cfg.models[0]}) failed: ${message}`;
            },
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
