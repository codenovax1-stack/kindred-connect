import { useEffect, useState } from "react";

interface Status {
  connected: boolean;
  provider: string;
  model: string | null;
  message: string | null;
  github?: { connected: boolean; defaultRepo: string | null };
}

/** Tiny indicator showing which external AI runtime the robots are using. */
export function RuntimeBadge() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/runtime-status")
      .then((r) => r.json() as Promise<Status>)
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!status) return null;

  return (
    <span
      className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs"
      title={
        status.connected
          ? `Robots run on ${status.provider} · ${status.model}${
              status.github?.connected ? " · GitHub code access on" : ""
            }`
          : (status.message ?? "AI runtime not connected")
      }
    >
      <span
        className={status.connected ? "text-emerald-400" : "text-destructive"}
        aria-hidden="true"
      >
        ●
      </span>
      <span className="font-display tracking-wide">
        {status.connected ? `AI RUNTIME: ${status.provider}` : "AI RUNTIME NOT CONNECTED"}
      </span>
    </span>
  );
}
