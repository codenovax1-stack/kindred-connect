/**
 * Real project / code access for the robots, through the linked GitHub
 * connection. Reads are free; anything that writes, commits or deletes is
 * approval-gated in the chat UI before it runs.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";

const GATEWAY = "https://connector-gateway.lovable.dev/github";

export function githubAvailable(): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"] && process.env["GITHUB_API_KEY"]);
}

export function defaultRepo(): string | undefined {
  return process.env["ROBOT_GITHUB_REPO"];
}

async function gh<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["GITHUB_API_KEY"];
  if (!lovableKey || !connectionKey) {
    throw new Error("GitHub is not connected for this app.");
  }
  const res = await fetch(`${GATEWAY}/${path.replace(/^\//, "")}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey,
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub request failed [${res.status}] ${path}: ${text.slice(0, 600)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function resolveRepo(repo?: string): string {
  const target = repo?.trim() || defaultRepo();
  if (!target || !target.includes("/")) {
    throw new Error(
      "No repository given. Call list_repos first, then pass repo as 'owner/name' (or set the ROBOT_GITHUB_REPO secret to make one the default).",
    );
  }
  return target;
}

/** Minimal unified diff so proposed edits can be reviewed before approval. */
export function unifiedDiff(path: string, before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`-${a[i]}`);
      i++;
    } else {
      out.push(`+${b[j]}`);
      j++;
    }
  }
  while (i < a.length) out.push(`-${a[i++]}`);
  while (j < b.length) out.push(`+${b[j++]}`);
  return out.join("\n");
}

function decodeBase64(data: string): string {
  const binary = atob(data.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readFile(repo: string, path: string, ref?: string) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const file = await gh<{ content?: string; sha: string; encoding?: string; size: number }>(
    `repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}${query}`,
  );
  return {
    path,
    sha: file.sha,
    size: file.size,
    content: file.content ? decodeBase64(file.content) : "",
  };
}

async function defaultBranch(repo: string): Promise<string> {
  const info = await gh<{ default_branch: string }>(`repos/${repo}`);
  return info.default_branch;
}

export function buildProjectTools(): ToolSet {
  if (!githubAvailable()) return {};
  const tools: ToolSet = {};

  tools["list_repos"] = tool({
    description: "List the GitHub repositories this app can access (owner/name, language, branch).",
    inputSchema: z.object({}),
    execute: async () => {
      const repos = await gh<
        { full_name: string; private: boolean; language: string | null; default_branch: string }[]
      >("user/repos?sort=updated&per_page=50");
      return {
        defaultRepo: defaultRepo() ?? null,
        repos: repos.map((r) => ({
          repo: r.full_name,
          private: r.private,
          language: r.language,
          branch: r.default_branch,
        })),
      };
    },
  });

  tools["list_files"] = tool({
    description:
      "List files in a repository (whole tree). Optionally filter by a path substring such as 'src/routes'.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
      filter: z.string().nullable().describe("Path substring filter, or null for everything"),
      ref: z.string().nullable().describe("Branch or commit, or null for the default branch"),
    }),
    execute: async ({ repo, filter, ref }) => {
      const target = resolveRepo(repo ?? undefined);
      const branch = ref ?? (await defaultBranch(target));
      const tree = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
        `repos/${target}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      );
      let files = tree.tree.filter((n) => n.type === "blob").map((n) => n.path);
      if (filter) files = files.filter((p) => p.includes(filter));
      return { repo: target, ref: branch, count: files.length, files: files.slice(0, 400) };
    },
  });

  tools["search_code"] = tool({
    description: "Search code inside a repository for a string or symbol.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
      query: z.string().describe("Search terms"),
    }),
    execute: async ({ repo, query }) => {
      const target = resolveRepo(repo ?? undefined);
      const q = encodeURIComponent(`${query} repo:${target}`);
      const found = await gh<{
        total_count: number;
        items: { path: string; html_url: string }[];
      }>(`search/code?q=${q}&per_page=20`);
      return {
        repo: target,
        total: found.total_count,
        matches: found.items.map((i) => ({ path: i.path, url: i.html_url })),
      };
    },
  });

  tools["read_file"] = tool({
    description: "Read the full text of one file in a repository.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
      path: z.string().describe("File path inside the repository"),
      ref: z.string().nullable().describe("Branch or commit, or null for the default branch"),
    }),
    execute: async ({ repo, path, ref }) => {
      const target = resolveRepo(repo ?? undefined);
      const file = await readFile(target, path, ref ?? undefined);
      return { repo: target, ...file, content: file.content.slice(0, 24000) };
    },
  });

  tools["git_status"] = tool({
    description:
      "Repository status: default branch, branches, latest commits and open pull requests.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
    }),
    execute: async ({ repo }) => {
      const target = resolveRepo(repo ?? undefined);
      const [info, branches, commits, pulls] = await Promise.all([
        gh<{ default_branch: string; pushed_at: string }>(`repos/${target}`),
        gh<{ name: string }[]>(`repos/${target}/branches?per_page=30`),
        gh<{ sha: string; commit: { message: string; author: { name: string; date: string } } }[]>(
          `repos/${target}/commits?per_page=10`,
        ),
        gh<{ number: number; title: string; head: { ref: string } }[]>(
          `repos/${target}/pulls?state=open&per_page=10`,
        ),
      ]);
      return {
        repo: target,
        defaultBranch: info.default_branch,
        lastPush: info.pushed_at,
        branches: branches.map((b) => b.name),
        commits: commits.map((c) => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split("\n")[0],
          author: c.commit.author.name,
          date: c.commit.author.date,
        })),
        openPullRequests: pulls.map((p) => ({ number: p.number, title: p.title, branch: p.head.ref })),
      };
    },
  });

  tools["git_diff"] = tool({
    description: "Diff two refs (branches or commits) in a repository, or inspect one commit.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
      base: z.string().describe("Base ref"),
      head: z.string().describe("Head ref"),
    }),
    execute: async ({ repo, base, head }) => {
      const target = resolveRepo(repo ?? undefined);
      const cmp = await gh<{
        status: string;
        ahead_by: number;
        behind_by: number;
        files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[];
      }>(`repos/${target}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
      return {
        repo: target,
        status: cmp.status,
        aheadBy: cmp.ahead_by,
        behindBy: cmp.behind_by,
        files: (cmp.files ?? []).slice(0, 20).map((f) => ({
          file: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch?.slice(0, 4000),
        })),
      };
    },
  });

  tools["check_status"] = tool({
    description:
      "Read the results of automated checks (GitHub Actions: typecheck, build, tests) for a repository.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
    }),
    execute: async ({ repo }) => {
      const target = resolveRepo(repo ?? undefined);
      const runs = await gh<{
        total_count: number;
        workflow_runs: { name: string; status: string; conclusion: string | null; head_branch: string; html_url: string; updated_at: string }[];
      }>(`repos/${target}/actions/runs?per_page=10`);
      if (!runs.total_count) {
        return { repo: target, runs: [], note: "This repository has no automated check runs." };
      }
      return {
        repo: target,
        runs: runs.workflow_runs.map((r) => ({
          workflow: r.name,
          status: r.status,
          conclusion: r.conclusion,
          branch: r.head_branch,
          updated: r.updated_at,
          url: r.html_url,
        })),
      };
    },
  });

  tools["propose_change"] = tool({
    description:
      "Prepare a change without writing anything: returns a unified diff of your new content against the current file. Always use this before commit_change so the operator can review.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
      path: z.string().describe("File path inside the repository"),
      content: z.string().describe("The complete new file content"),
    }),
    execute: async ({ repo, path, content }) => {
      const target = resolveRepo(repo ?? undefined);
      let before = "";
      let exists = true;
      try {
        before = (await readFile(target, path)).content;
      } catch {
        exists = false;
      }
      return {
        repo: target,
        path,
        newFile: !exists,
        diff: unifiedDiff(path, before, content).slice(0, 12000),
      };
    },
  });

  tools["commit_change"] = tool({
    description:
      "Create or update a file in the repository with a commit. Requires operator approval. Commits to a branch (never straight to the default branch unless it is named explicitly).",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
      path: z.string().describe("File path inside the repository"),
      content: z.string().describe("The complete new file content"),
      message: z.string().describe("Commit message"),
      branch: z.string().nullable().describe("Branch to commit to, or null for a new robot/* branch"),
    }),
    needsApproval: true,
    execute: async ({ repo, path, content, message, branch }) => {
      const target = resolveRepo(repo ?? undefined);
      const base = await defaultBranch(target);
      let targetBranch = branch ?? `robot/${Date.now()}`;
      if (!branch) {
        const ref = await gh<{ object: { sha: string } }>(`repos/${target}/git/ref/heads/${base}`);
        await gh(`repos/${target}/git/refs`, {
          method: "POST",
          body: { ref: `refs/heads/${targetBranch}`, sha: ref.object.sha },
        });
      } else {
        targetBranch = branch;
      }
      let sha: string | undefined;
      try {
        sha = (await readFile(target, path, targetBranch)).sha;
      } catch {
        sha = undefined;
      }
      const result = await gh<{ commit: { sha: string; html_url: string } }>(
        `repos/${target}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "PUT",
          body: {
            message,
            content: encodeBase64(content),
            branch: targetBranch,
            ...(sha ? { sha } : {}),
          },
        },
      );
      return {
        repo: target,
        path,
        branch: targetBranch,
        commit: result.commit.sha.slice(0, 7),
        url: result.commit.html_url,
      };
    },
  });

  tools["delete_file"] = tool({
    description: "Delete a file from the repository. Requires operator approval.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
      path: z.string().describe("File path inside the repository"),
      message: z.string().describe("Commit message"),
      branch: z.string().nullable().describe("Branch to delete from, or null for the default branch"),
    }),
    needsApproval: true,
    execute: async ({ repo, path, message, branch }) => {
      const target = resolveRepo(repo ?? undefined);
      const targetBranch = branch ?? (await defaultBranch(target));
      const file = await readFile(target, path, targetBranch);
      const result = await gh<{ commit: { sha: string; html_url: string } }>(
        `repos/${target}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
        { method: "DELETE", body: { message, sha: file.sha, branch: targetBranch } },
      );
      return {
        repo: target,
        path,
        branch: targetBranch,
        deleted: true,
        commit: result.commit.sha.slice(0, 7),
        url: result.commit.html_url,
      };
    },
  });

  tools["open_pull_request"] = tool({
    description: "Open a pull request from a branch. Requires operator approval.",
    inputSchema: z.object({
      repo: z.string().nullable().describe("owner/name, or null for the default repo"),
      head: z.string().describe("Branch containing the changes"),
      title: z.string().describe("Pull request title"),
      body: z.string().describe("Pull request description"),
    }),
    needsApproval: true,
    execute: async ({ repo, head, title, body }) => {
      const target = resolveRepo(repo ?? undefined);
      const base = await defaultBranch(target);
      const pr = await gh<{ number: number; html_url: string }>(`repos/${target}/pulls`, {
        method: "POST",
        body: { title, body, head, base },
      });
      return { repo: target, number: pr.number, url: pr.html_url };
    },
  });

  return tools;
}
