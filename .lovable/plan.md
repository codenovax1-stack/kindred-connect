# Reliable multi-robot chat sessions

## Goal
Fix shared chat failures without changing the existing design or removing features. Every robot will keep an independent conversation and continue working when its page is not open.

## Implementation

### 1. Move robot chat lifecycles above individual pages
- Add a browser-side robot session registry with exactly one AI chat controller per robot ID.
- Keep controllers alive while navigating between the command center and robot pages.
- Give every controller its own transport, messages, request state, status, and cancellation handle so one robot cannot reset or block another.
- Make the robot page subscribe to its existing controller instead of creating and destroying `useChat` state on every mount.

### 2. Make history persistence race-free
- Hydrate each robot controller from its own `rcc:chat:<robotId>` record before that controller is created.
- Persist optimistic user messages, streamed assistant progress, completed responses, tool results, and stopped partial responses from the controller itself, even when its page is unmounted.
- Never save an empty default over stored history during initial loading.
- Preserve separate histories for all seven built-in robots and added robots across navigation and reloads.
- Keep memory extraction, page-read logging, task activity, and delegation logging attached to the persistent controller rather than the currently visible page.

### 3. Centralize status and cancellation
- Update each robot’s stored status from its own controller lifecycle.
- Keep working status visible after leaving a robot and restore the live stream when returning.
- Change STOP ALL to stop every registered active controller, including robots whose pages are not mounted.
- Keep the individual Stop button scoped to only the current robot and active from the initial thinking state through streaming.

### 4. Fix generic stream failures
- Add explicit stream-time error handling in the chat endpoint; asynchronous model/tool failures currently bypass the surrounding `try/catch` and become the AI SDK’s default “An error occurred.”
- Return safe, actionable messages for configuration, credits, rate limits, invalid requests, tool failures, and temporary service errors without exposing secrets.
- Preserve the requested model, web search/read tools, SHUB delegation, and cancellation signal.
- Bound oversized model context without deleting the locally stored visible conversation, preventing long histories and large tool outputs from causing avoidable request failures.

### 5. Preserve the current interface
- Keep the dashboard, robot cards, chat layout, controls, colors, and all existing robot capabilities unchanged.
- Only adjust wiring required for persistent independent sessions and accurate errors.

## Verification
- Check all seven robots can open, send, receive, leave, return, and reload with separate histories.
- Run the exact scenario: start a long ZYRON task, switch to SHUB, send multiple SHUB messages, leave and return, confirm SHUB history, confirm ZYRON remains active, then return to ZYRON and confirm its progress/history.
- Verify SHUB delegates to ZYRON and robot-to-robot activity is recorded.
- Verify live web search and webpage reading.
- Create and open an added robot, chat, navigate away, return, and reload.
- Verify individual Stop and STOP ALL, including off-screen active robots.
- Confirm no maximum-depth or React console errors, no generic masked stream errors, and one API request per user turn.
