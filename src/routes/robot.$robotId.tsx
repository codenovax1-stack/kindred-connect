import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eraser } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  loadMessages,
  loadMemory,
  logActivity,
  saveMemoryNote,
  saveMessages,
  clearMessages,
  useMemory,
  useRobots,
  useStatuses,
} from "@/lib/command-center-store";

export const Route = createFileRoute("/robot/$robotId")({
  head: () => ({
    meta: [
      { title: "Robot Channel — AI Robot Command Center" },
      {
        name: "description",
        content: "Direct conversation channel with one robot of your private AI team.",
      },
      { property: "og:title", content: "Robot Channel — AI Robot Command Center" },
      {
        property: "og:description",
        content: "Direct conversation channel with one robot of your private AI team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RobotChannel,
});

function RobotChannel() {
  const { robotId } = useParams({ from: "/robot/$robotId" });
  const { robots } = useRobots();
  const { setStatus } = useStatuses();
  const memory = useMemory(robotId);
  const robot = robots.find((r) => r.id === robotId);
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [input, setInput] = useState("");
  const loggedParts = useRef<Set<string>>(new Set());

  useEffect(() => {
    setInitial(loadMessages(robotId));
  }, [robotId]);

  // Latest robot/roster are read through a ref so the transport identity stays
  // stable — recreating it on every render re-initialises useChat endlessly.
  const contextRef = useRef({ robot, robots });
  contextRef.current = { robot, robots };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            messages,
            robot: contextRef.current.robot,
            roster: contextRef.current.robots,
            memory: loadMemory(robotId),
          },
        }),
      }),
    [robotId],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: robotId,
    ...(initial ? { messages: initial } : {}),
    transport,
    onFinish: ({ message }) => {
      setStatus(robotId, "online");
      const text = message.parts
        .filter((p) => p.type === "text")
        .map((p) => ("text" in p ? p.text : ""))
        .join(" ");
      logActivity({
        robotId,
        robotName: robot?.name ?? robotId,
        kind: "done",
        text: text.slice(0, 140) || "Task completed.",
      });
    },
    onError: (err) => {
      setStatus(robotId, "error");
      logActivity({
        robotId,
        robotName: robot?.name ?? robotId,
        kind: "error",
        text: err.message.slice(0, 180),
      });
    },
  });

  // Persist conversation, memory notes, delegations and page visits.
  useEffect(() => {
    if (!initial) return;
    saveMessages(robotId, messages);
    for (const message of messages) {
      let index = -1;
      for (const part of message.parts) {
        index += 1;
        if (!part.type.startsWith("tool-")) continue;
        const tp = part as ToolPart;
        if (tp.state !== "output-available" || !tp.output) continue;
        const key = `${message.id}:${index}`;
        if (loggedParts.current.has(key)) continue;
        loggedParts.current.add(key);
        const out = tp.output as Record<string, unknown>;
        if (part.type === "tool-save_memory" && typeof out["note"] === "string") {
          saveMemoryNote(robotId, out["note"]);
        }
        if (part.type === "tool-read_page" && typeof out["url"] === "string") {
          logActivity({
            robotId,
            robotName: robot?.name ?? robotId,
            kind: "browse",
            text: (out["title"] as string) || (out["url"] as string),
            url: out["url"],
          });
        }
        if (part.type === "tool-delegate_to_robot" && typeof out["robot"] === "string") {
          logActivity({
            robotId,
            robotName: robot?.name ?? robotId,
            kind: "delegation",
            text: `→ ${out["robot"]}: ${String(out["task"] ?? "").slice(0, 110)}`,
          });
        }
      }
    }
  }, [messages, initial, robotId, robot?.name]);

  // Global STOP ALL ROBOTS.
  useEffect(() => {
    const onStop = () => stop();
    window.addEventListener("rcc:stop-all", onStop);
    return () => window.removeEventListener("rcc:stop-all", onStop);
  }, [stop]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [robotId, status]);

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setStatus(robotId, "working");
      logActivity({
        robotId,
        robotName: robot?.name ?? robotId,
        kind: "task",
        text: trimmed.slice(0, 140),
      });
      sendMessage({ text: trimmed });
      setInput("");
    },
    [robot?.name, robotId, sendMessage, setStatus],
  );

  if (!robot) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="panel p-8 text-center">
          <h1 className="font-display text-xl">Robot not found</h1>
          <Link to="/" className="mt-4 inline-block text-primary hover:underline">
            Back to command center
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-screen w-full max-w-5xl flex-col px-4 py-4 sm:px-6">
      <header className="panel flex flex-wrap items-center gap-3 p-4">
        <Link
          to="/"
          className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"
          aria-label="Back to command center"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div
          className="flex h-11 w-11 items-center justify-center rounded-md border text-2xl"
          style={{
            borderColor: `hsl(${robot.accent} / 0.5)`,
            background: `hsl(${robot.accent} / 0.12)`,
          }}
        >
          {robot.avatar}
        </div>
        <div className="mr-auto">
          <h1 className="font-display text-lg leading-none">{robot.name}</h1>
          <p className="text-sm text-muted-foreground">{robot.role}</p>
        </div>
        <Badge variant="secondary">{memory.length} memories</Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            clearMessages(robotId);
            window.location.reload();
          }}
        >
          <Eraser className="mr-1 h-4 w-4" /> New conversation
        </Button>
      </header>

      <Conversation className="mt-4 min-h-0 flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title={`${robot.name} is online`}
              description={`${robot.description} Ask it anything — it can search the web, open pages and reason across sources.`}
            />
          )}
          {messages.map((message) => (
            <Message from={message.role} key={message.id}>
              <MessageContent>
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    return message.role === "assistant" ? (
                      <MessageResponse key={index}>{part.text}</MessageResponse>
                    ) : (
                      <p key={index} className="whitespace-pre-wrap">
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type === "reasoning" && part.text) {
                    return (
                      <p key={index} className="text-xs italic text-muted-foreground">
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    const tp = part as ToolPart;
                    const name = part.type.replace("tool-", "");
                    return (
                      <Tool key={index} defaultOpen={false}>
                        <ToolHeader
                          type={part.type as `tool-${string}`}
                          state={tp.state}
                          title={name.replace(/_/g, " ")}
                        />
                        <ToolContent>
                          <ToolInput input={tp.input} />
                          <ToolOutput output={tp.output} errorText={tp.errorText} />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
          {(status === "submitted" || status === "streaming") && (
            <Shimmer className="text-sm">{`${robot.name} is working...`}</Shimmer>
          )}
          {error && (
            <p className="text-sm text-destructive">
              {robot.name} hit an error: {error.message}
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        className="mt-3"
        onSubmit={(payload) => {
          submit(payload.text ?? input);
        }}
      >
        <PromptInputTextarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Command ${robot.name}...`}
        />
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit status={status} onClick={() => status === "streaming" && stop()} />
        </PromptInputFooter>
      </PromptInput>
    </main>
  );
}
