import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import type { Robot } from "@/lib/robots";

const AVATARS = ["🤖", "🧠", "🛰️", "⚡", "🧩", "🔭", "📈", "🛠️", "🧿", "🚀"];
const ACCENTS = ["180 100% 60%", "270 90% 70%", "45 95% 60%", "140 80% 55%", "320 90% 65%"];

export function AddRobotDialog({ onCreate }: { onCreate: (robot: Robot) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("🤖");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [personality, setPersonality] = useState("");
  const [instructions, setInstructions] = useState("");
  const [memory, setMemory] = useState(true);
  const [web, setWeb] = useState(true);
  const [browser, setBrowser] = useState(true);
  const [files, setFiles] = useState(true);
  const [delegate, setDelegate] = useState(false);
  const [requireConfirmation, setRequireConfirmation] = useState(true);

  const reset = () => {
    setName("");
    setAvatar("🤖");
    setRole("");
    setDescription("");
    setPersonality("");
    setInstructions("");
    setMemory(true);
    setWeb(true);
    setBrowser(true);
    setFiles(true);
    setDelegate(false);
    setRequireConfirmation(true);
  };

  const submit = () => {
    const cleanName = name.trim().toUpperCase();
    if (!cleanName || !role.trim()) return;
    const tools = ["web_search", "read_page", "save_memory"];
    if (delegate) tools.push("delegate_to_robot");
    onCreate({
      id: `${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
      name: cleanName,
      avatar,
      role: role.trim(),
      description: description.trim() || role.trim(),
      personality: personality.trim(),
      instructions: instructions.trim(),
      capabilities: { memory, web, browser, files, delegate },
      tools,
      requireConfirmation,
      builtin: false,
      createdAt: Date.now(),
      accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)]!,
    });
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="font-display tracking-widest">
          <Plus className="mr-1 h-4 w-4" /> ADD ROBOT
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display neon-text">CREATE NEW AI ROBOT</DialogTitle>
          <DialogDescription>
            A new robot joins the team permanently with its own identity, memory and conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="robot-name">Robot name</Label>
              <Input
                id="robot-name"
                placeholder="NOVA"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="robot-role">Primary role</Label>
              <Input
                id="robot-role"
                placeholder="Business Analyst"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Avatar</Label>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAvatar(a)}
                  className={`h-10 w-10 rounded-md border text-xl transition-colors ${
                    avatar === a ? "border-primary bg-primary/15" : "border-border hover:bg-muted"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="robot-desc">Description</Label>
            <Input
              id="robot-desc"
              placeholder="Finds and evaluates business opportunities."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="robot-personality">Personality</Label>
            <Input
              id="robot-personality"
              placeholder="Direct, commercial, numbers-first."
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="robot-instructions">System instructions</Label>
            <Textarea
              id="robot-instructions"
              rows={4}
              placeholder="Find and analyze business opportunities for my projects."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            {(
              [
                ["Memory", memory, setMemory, "Remembers facts between chats"],
                ["Web access", web, setWeb, "Search the live web"],
                ["Browser actions", browser, setBrowser, "Open and navigate pages"],
                ["File understanding", files, setFiles, "Read documents and data"],
                ["Can delegate", delegate, setDelegate, "Assign work to other robots"],
                [
                  "Confirm before acting",
                  requireConfirmation,
                  setRequireConfirmation,
                  "Ask before consequential actions",
                ],
              ] as [string, boolean, (v: boolean) => void, string][]
            ).map(([label, value, setter, hint]) => (
              <label key={label} className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
                <Switch checked={value} onCheckedChange={setter} />
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || !role.trim()}>
            Create robot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
