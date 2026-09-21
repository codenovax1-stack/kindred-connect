import { useCallback, useEffect, useState } from "react";
import type { UIMessage } from "ai";
import { DEFAULT_ROBOTS, type Robot, type RobotStatus } from "./robots";

const ROBOTS_KEY = "rcc:robots:v1";
const ACTIVITY_KEY = "rcc:activity:v1";
const MEMORY_KEY = (id: string) => `rcc:memory:${id}`;
const CHAT_KEY = (id: string) => `rcc:chat:${id}`;
const STATUS_KEY = "rcc:status:v1";

export type ActivityKind = "task" | "done" | "error" | "delegation" | "browse" | "memory";

export interface ActivityEntry {
  id: string;
  robotId: string;
  robotName: string;
  kind: ActivityKind;
  text: string;
  url?: string;
  at: number;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("rcc:changed", { detail: key }));
  } catch {
    /* storage full or unavailable */
  }
}

function useStoredValue<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setValue(read<T>(key, fallback));
    setHydrated(true);
    const onChange = () => setValue(read<T>(key, fallback));
    window.addEventListener("rcc:changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("rcc:changed", onChange);
      window.removeEventListener("storage", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );

  return { value, update, hydrated };
}

/* ---------------- robots ---------------- */

export function loadRobots(): Robot[] {
  const stored = read<Robot[] | null>(ROBOTS_KEY, null);
  if (!stored || stored.length === 0) return DEFAULT_ROBOTS;
  const missingBuiltins = DEFAULT_ROBOTS.filter((d) => !stored.some((s) => s.id === d.id));
  return [
    ...DEFAULT_ROBOTS.filter((d) => stored.some((s) => s.id === d.id)).map((d) => {
      const override = stored.find((s) => s.id === d.id)!;
      return { ...d, ...override, builtin: true };
    }),
    ...missingBuiltins,
    ...stored.filter((s) => !s.builtin),
  ].sort((a, b) => (a.builtin === b.builtin ? a.createdAt - b.createdAt : a.builtin ? -1 : 1));
}

export function useRobots() {
  const { value, update, hydrated } = useStoredValue<Robot[]>(ROBOTS_KEY, DEFAULT_ROBOTS);
  const robots = hydrated ? loadRobots() : DEFAULT_ROBOTS;

  const addRobot = useCallback((robot: Robot) => update([...loadRobots(), robot]), [update]);
  const removeRobot = useCallback(
    (id: string) => {
      update(loadRobots().filter((r) => r.id !== id));
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(CHAT_KEY(id));
        window.localStorage.removeItem(MEMORY_KEY(id));
      }
    },
    [update],
  );

  return { robots, addRobot, removeRobot, raw: value };
}

/* ---------------- status ---------------- */

export function useStatuses() {
  const { value, update } = useStoredValue<Record<string, RobotStatus>>(STATUS_KEY, {});
  const setStatus = useCallback(
    (id: string, status: RobotStatus) =>
      update({ ...read<Record<string, RobotStatus>>(STATUS_KEY, {}), [id]: status }),
    [update],
  );
  const resetAll = useCallback(() => update({}), [update]);
  return { statuses: value, setStatus, resetAll };
}

/* ---------------- activity ---------------- */

export function logActivity(entry: Omit<ActivityEntry, "id" | "at">) {
  const list = read<ActivityEntry[]>(ACTIVITY_KEY, []);
  const next = [{ ...entry, id: crypto.randomUUID(), at: Date.now() }, ...list].slice(0, 120);
  write(ACTIVITY_KEY, next);
}

export function useActivity() {
  const { value } = useStoredValue<ActivityEntry[]>(ACTIVITY_KEY, []);
  return value;
}

export function clearActivity() {
  write(ACTIVITY_KEY, []);
}

/* ---------------- memory ---------------- */

export function loadMemory(robotId: string): string[] {
  return read<string[]>(MEMORY_KEY(robotId), []);
}

export function saveMemoryNote(robotId: string, note: string) {
  const current = loadMemory(robotId);
  if (current.includes(note)) return;
  write(MEMORY_KEY(robotId), [...current, note].slice(-60));
}

export function useMemory(robotId: string) {
  const { value } = useStoredValue<string[]>(MEMORY_KEY(robotId), []);
  return value;
}

/* ---------------- conversations ---------------- */

export function loadMessages(robotId: string): UIMessage[] {
  return read<UIMessage[]>(CHAT_KEY(robotId), []);
}

export function saveMessages(robotId: string, messages: UIMessage[]) {
  write(CHAT_KEY(robotId), messages);
}

export function clearMessages(robotId: string) {
  write(CHAT_KEY(robotId), []);
}

export const STOP_FLAG_EVENT = "rcc:stop-all";
