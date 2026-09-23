# Roadmap

## Current task: move robots off Lovable AI (active)

- [ ] Add a server-side external AI runtime config layer (provider, base URL, model, API key from secret)
- [ ] Rewrite `/api/chat` to use only the external runtime; no Lovable AI, no fallback
- [ ] Return a clear "AI runtime not connected" error when the runtime is unconfigured
- [ ] All 7 robots + custom robots + delegation use the same external runtime
- [ ] Add project/code tools: search files, read file, write/create file, edit file, delete (approval only), git status/diff, safe checks (typecheck/build/tests), propose diff for approval
- [ ] Destructive actions require explicit user approval (read -> propose -> diff -> approve -> execute)
- [ ] Keep current UI; at most a tiny runtime connection indicator
- [ ] Never expose the API key to the browser, localStorage or robot memory
- [ ] Verify: no Lovable AI call on chat, delegation, code analysis, project actions, background tasks, tool calls

## Deferred (previous request, not part of the current task)

- [ ] Persistent independent per-robot chat sessions that survive navigation
- [ ] Background robot tasks continue while chatting with another robot
- [ ] Fix generic stream error masking and update-depth loops
