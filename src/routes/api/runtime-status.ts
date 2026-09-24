import { createFileRoute } from "@tanstack/react-router";
import { runtimeStatus } from "@/lib/robot-runtime.server";
import { defaultRepo, githubAvailable } from "@/lib/github-tools.server";

export const Route = createFileRoute("/api/runtime-status")({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          ...runtimeStatus(),
          github: { connected: githubAvailable(), defaultRepo: defaultRepo() ?? null },
        }),
    },
  },
});
