import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Globe, Radio, Share2, Trash2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddRobotDialog } from "@/components/AddRobotDialog";
import {
  clearActivity,
  logActivity,
  useActivity,
  useRobots,
  useStatuses,
  type ActivityEntry,
} from "@/lib/command-center-store";
import type { Robot, RobotStatus } from "@/lib/robots";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Robot Command Center — Control Deck" },
      {
        name: "description",
        content:
          "Command deck for a private team of AI robots: SHUB, ARSHAD, RUDRA, HAYATO, ZYRON, VANTA and ORION.",
      },
      { property: "og:title", content: "AI Robot Command Center — Control Deck" },
      {
        property: "og:description",
        content: "Command deck for a private team of specialist AI robots.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CommandCenter,
});

const STATUS_STYLE: Record<RobotStatus, string> = {
  online: "text-emerald-400",
  working: "text-cyan-300",
  waiting: "text-amber-300",
  error: "text-red-400",
};

const STATUS_LABEL: Record<RobotStatus, string> = {
  online: "Online",
  working: "Working",
  waiting: "Waiting",
  error: "Error",
};

function timeAgo(at: number) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function RobotCard({
  robot,
  status,
  onDelete,
}: {
  robot: Robot;
  status: RobotStatus;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="panel scanline group relative overflow-hidden p-4 transition-transform hover:-translate-y-1"
      style={{
        boxShadow: `inset 0 1px 0 oklch(1 0 0 / 8%), 0 0 0 1px hsl(${robot.accent} / 0.18)`,
      }}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-35 blur-2xl transition-opacity group-hover:opacity-60"
        style={{ background: `hsl(${robot.accent} / 0.55)` }}
      />
      <Link to="/robot/$robotId" params={{ robotId: robot.id }} className="block">
        <div className="flex items-start gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-md border text-2xl"
            style={{
              borderColor: `hsl(${robot.accent} / 0.5)`,
              background: `hsl(${robot.accent} / 0.1)`,
            }}
          >
            {robot.avatar}
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-lg leading-none">{robot.name}</h3>
            <p className={`mt-2 text-xs font-semibold ${STATUS_STYLE[status]}`}>
              ● {STATUS_LABEL[status]}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{robot.role}</p>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{robot.description}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {robot.capabilities.web && <Badge variant="secondary">web</Badge>}
          {robot.capabilities.browser && <Badge variant="secondary">browser</Badge>}
          {robot.capabilities.memory && <Badge variant="secondary">memory</Badge>}
          {robot.capabilities.delegate && <Badge variant="secondary">delegates</Badge>}
        </div>
      </Link>
      {!robot.builtin && (
        <button
          type="button"
          onClick={() => onDelete(robot.id)}
          aria-label={`Delete ${robot.name}`}
          className="absolute bottom-3 right-3 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function Panel({
  title,
  icon,
  entries,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  entries: ActivityEntry[];
  empty: string;
}) {
  return (
    <section className="panel p-4">
      <h2 className="flex items-center gap-2 font-display text-sm text-muted-foreground">
        {icon}
        {title}
      </h2>
      <ul className="mt-3 space-y-2 text-sm">
        {entries.length === 0 && <li className="text-muted-foreground/70">{empty}</li>}
        {entries.slice(0, 6).map((e) => (
          <li key={e.id} className="border-l-2 border-primary/40 pl-3">
            <span className="font-display text-xs text-primary">{e.robotName}</span>
            <span className="ml-2 text-xs text-muted-foreground">{timeAgo(e.at)}</span>
            <p className="text-muted-foreground">
              {e.url ? (
                <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-primary">
                  {e.text}
                </a>
              ) : (
                e.text
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommandCenter() {
  const { robots, addRobot, removeRobot } = useRobots();
  const { statuses, resetAll } = useStatuses();
  const activity = useActivity();

  const working = robots.filter((r) => (statuses[r.id] ?? "online") === "working");
  const errors = activity.filter((a) => a.kind === "error");
  const done = activity.filter((a) => a.kind === "done");
  const tasks = activity.filter((a) => a.kind === "task");
  const delegations = activity.filter((a) => a.kind === "delegation");
  const sessions = activity.filter((a) => a.kind === "browse");

  const stopAll = () => {
    window.dispatchEvent(new CustomEvent("rcc:stop-all"));
    resetAll();
    logActivity({
      robotId: "system",
      robotName: "SYSTEM",
      kind: "error",
      text: "STOP ALL ROBOTS triggered — running work halted.",
    });
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h1 className="text-2xl neon-text sm:text-3xl">AI ROBOT COMMAND CENTER</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {robots.length} robots online · {working.length} working · private multi-agent control
            layer
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RuntimeBadge />
          <AddRobotDialog onCreate={addRobot} />
          <Button variant="destructive" className="font-display tracking-widest" onClick={stopAll}>
            <Zap className="mr-1 h-4 w-4" /> STOP ALL
          </Button>
        </div>
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {robots.map((robot) => (
          <RobotCard
            key={robot.id}
            robot={robot}
            status={statuses[robot.id] ?? "online"}
            onDelete={removeRobot}
          />
        ))}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel
          title="ACTIVE TASKS"
          icon={<Radio className="h-4 w-4" />}
          entries={tasks}
          empty="No tasks dispatched yet."
        />
        <Panel
          title="RECENT ACTIVITY"
          icon={<Radio className="h-4 w-4" />}
          entries={activity}
          empty="Activity appears here as robots work."
        />
        <Panel
          title="ROBOT-TO-ROBOT"
          icon={<Share2 className="h-4 w-4" />}
          entries={delegations}
          empty="Ask SHUB to coordinate the team."
        />
        <Panel
          title="BROWSER SESSIONS"
          icon={<Globe className="h-4 w-4" />}
          entries={sessions}
          empty="Pages a robot opens are listed here."
        />
        <Panel
          title="COMPLETED"
          icon={<Radio className="h-4 w-4" />}
          entries={done}
          empty="Nothing completed yet."
        />
        <Panel
          title="ERRORS / ALERTS"
          icon={<AlertTriangle className="h-4 w-4" />}
          entries={errors}
          empty="No alerts."
        />
      </div>

      <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
        <p>
          Local desktop agent bridge (Gmail accounts, files, computer actions): not connected yet.
        </p>
        <button type="button" className="hover:text-foreground" onClick={clearActivity}>
          Clear activity log
        </button>
      </div>
    </main>
  );
}
