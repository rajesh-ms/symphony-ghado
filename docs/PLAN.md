# Symphony Implementation Plan

> **Language**: TypeScript (Node.js 20+)
> **Runtime**: Single-process event-loop daemon
> **Spec reference**: [.github/instructions/prodspec.instructions.md](.github/instructions/prodspec.instructions.md)

### Implementation Status: **COMPLETE** ✅

All 13 phases (0–12) implemented. **135 tests passing** across 9 test files. Clean TypeScript build.

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Project Scaffold & Tooling | ✅ |
| 1 | Core Domain Model & Types | ✅ |
| 2 | Workflow Loader & Config Layer | ✅ |
| 3 | Issue Tracker Client (ADO) | ✅ |
| 4 | Workspace Manager | ✅ |
| 5 | Prompt Renderer | ✅ |
| 6 | Codex App-Server Client | ✅ |
| 7 | Agent Runner (Worker) | ✅ |
| 8 | Orchestrator | ✅ |
| 9 | Structured Logging + Watcher | ✅ |
| 10 | CLI Entry Point | ✅ |
| 11 | HTTP Server Extension | ✅ |
| 12 | Integration Tests & Example | ✅ |

---

## Phase 0 — Project Scaffold & Tooling ✅

### 0.1 Initialize Node.js project
- `npm init` with name `symphony`, `"type": "module"`.
- Create `tsconfig.json` (strict, ESNext modules, `outDir: dist`).
- Add dev-dependencies: `typescript`, `tsx` (dev runner), `vitest` (test framework), `@types/node`.
- Add runtime dependencies: `yaml` (YAML parsing), `liquidjs` (Liquid template engine), `chokidar` (file watcher).
- Scripts: `build`, `start`, `dev` (`tsx`), `test` (`vitest`), `lint`.

### 0.2 Directory structure
```
src/
  index.ts                  # CLI entry point
  types.ts                  # Core domain model types (Section 4)
  config/
    workflow-loader.ts      # WORKFLOW.md parser (Section 5)
    config.ts               # Typed config layer with defaults (Section 6)
    validation.ts           # Dispatch preflight validation (Section 6.3)
  tracker/
    types.ts                # Tracker adapter interface
    ado-client.ts           # Azure DevOps REST client (Section 11)
    normalize.ts            # ADO payload → Issue normalization (Section 11.3)
  orchestrator/
    state.ts                # OrchestratorState data structure (Section 4.1.8)
    orchestrator.ts         # Poll loop, dispatch, reconciliation (Sections 7-8)
    scheduler.ts            # Retry queue & backoff logic (Section 8.4)
    dispatch.ts             # Candidate selection & sorting (Section 8.2)
  workspace/
    manager.ts              # Workspace create/reuse/clean (Section 9)
    hooks.ts                # Hook runner with timeout (Section 9.4)
    safety.ts               # Path containment & sanitization (Section 9.5)
  agent/
    runner.ts               # Worker: workspace + prompt + agent lifecycle (Section 10.7)
    app-server-client.ts    # Codex app-server JSON-RPC stdio client (Section 10.1-10.3)
    protocol.ts             # Protocol message types & line parser
    events.ts               # Event normalization & emitter (Section 10.4)
    tools/
      ado-api.ts            # Optional ado_api client-side tool (Section 10.5)
  prompt/
    renderer.ts             # Liquid prompt rendering (Section 12)
  observability/
    logger.ts               # Structured logger (Section 13.1)
    snapshot.ts             # Runtime snapshot builder (Section 13.3)
  server/                   # Optional HTTP extension (Section 13.7)
    server.ts               # Express/Fastify HTTP server
    routes.ts               # /api/v1/* endpoints
    dashboard.ts            # / HTML dashboard
tests/
  unit/                     # Unit tests per module
  integration/              # Integration tests with mocked tracker/codex
WORKFLOW.md                 # Example workflow file
```

### 0.3 Create `.gitignore`, `README.md`

---

## Phase 1 — Core Domain Model & Types (Section 4) ✅

### 1.1 Define `src/types.ts`
- `Issue` interface (id, identifier, title, description, priority, state, branch_name, url, labels, blocked_by, created_at, updated_at).
- `BlockerRef` interface (id, identifier, state — all nullable).
- `WorkflowDefinition` interface (config: Record<string, unknown>, prompt_template: string).
- `ServiceConfig` interface — typed getters for all config fields from Section 6.4.
- `Workspace` interface (path, workspace_key, created_now).
- `RunAttempt` interface (issue_id, issue_identifier, attempt, workspace_path, started_at, status, error).
- `RunAttemptStatus` enum (PreparingWorkspace, BuildingPrompt, LaunchingAgentProcess, InitializingSession, StreamingTurn, Finishing, Succeeded, Failed, TimedOut, Stalled, CanceledByReconciliation).
- `LiveSession` interface — all fields from Section 4.1.6.
- `RetryEntry` interface (issue_id, identifier, attempt, due_at_ms, timer_handle, error).
- `OrchestratorState` interface — all fields from Section 4.1.8.
- `CodexTotals` interface (input_tokens, output_tokens, total_tokens, seconds_running).
- Normalization helpers: `sanitizeWorkspaceKey(identifier)`, `normalizeState(state)`, `buildSessionId(threadId, turnId)`.

### 1.2 Tests
- `sanitizeWorkspaceKey` replaces non-`[A-Za-z0-9._-]` with `_`.
- `normalizeState` trims and lowercases.
- `buildSessionId` composes `<thread>-<turn>`.

---

## Phase 2 — Workflow Loader & Config Layer (Sections 5–6) ✅

### 2.1 `src/config/workflow-loader.ts`
- `loadWorkflow(filePath: string): WorkflowDefinition`
- Parse `---` delimited YAML front matter; reject non-map YAML.
- Return `{ config, prompt_template }`.
- Error classes: `missing_workflow_file`, `workflow_parse_error`, `workflow_front_matter_not_a_map`.

### 2.2 `src/config/config.ts`
- `resolveConfig(rawConfig: Record<string, unknown>): ServiceConfig`
- Implement `$VAR` env resolution, `~` expansion, path normalization.
- Apply all defaults from Section 6.4.
- Coerce string-integers to numbers where needed.
- Parse `active_states` / `terminal_states` from list or comma-separated string.
- Normalize `max_concurrent_agents_by_state` keys (trim+lowercase, drop invalid values).

### 2.3 `src/config/validation.ts`
- `validateDispatchConfig(config: ServiceConfig): ValidationResult`
- Check: tracker.kind present & supported, api_key resolved, project_slug present, codex.command non-empty.

### 2.4 File watcher (dynamic reload)
- Use `chokidar` to watch `WORKFLOW.md`.
- On change: reload, re-resolve, re-validate; keep last-good on failure.
- Emit structured log on reload success/failure.

### 2.5 Tests
- Parse valid WORKFLOW.md with front matter + prompt body.
- Parse WORKFLOW.md without front matter (entire file = prompt).
- Reject non-map front matter.
- Missing file error.
- `$VAR` resolution with set/unset/empty env vars.
- Defaults applied when optional keys absent.
- Validation passes/fails for required fields.

---

## Phase 3 — Issue Tracker Client — Azure DevOps (Section 11) ✅

### 3.1 `src/tracker/ado-client.ts`
- `AdoClient` class with constructor taking endpoint, apiKey, projectSlug.
- HTTP Basic auth: base64 of `:PAT`.
- `fetchCandidateIssues(activeStates: string[]): Promise<Issue[]>`
  - WIQL POST: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] IN (...)`.
  - Paginate with `$top=200` and continuation tokens.
  - Batch fetch details: `GET _apis/wit/workitems?ids=...&$expand=relations`.
- `fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>`
  - Batch work items endpoint filtered to given IDs.
- `fetchIssuesByStates(states: string[]): Promise<Issue[]>`
  - WIQL filtered by given states (used for terminal cleanup).
- Network timeout: 30000 ms.

### 3.2 `src/tracker/normalize.ts`
- Map ADO fields → Issue model (Section 11.3).
- `System.Title` → title, `System.State` → state, `System.Description` → description.
- `Microsoft.VSTS.Common.Priority` → priority (integer or null).
- `System.Tags` → labels (semicolon-split, lowercase).
- Relations of type `System.LinkTypes.BlockedBy` → blocked_by array.
- `System.CreatedDate` / `System.ChangedDate` → ISO timestamps.
- `identifier` = string of ADO work item ID.
- `url` from `_links.html.href` or constructed.

### 3.3 Tests
- Normalize a full ADO work item payload → Issue.
- Labels normalized to lowercase, semicolon-split.
- Blockers extracted from relations.
- Priority: valid int, non-int → null.
- WIQL query builds correct filter for active states.
- Pagination with continuation tokens.
- Error mapping: request error, non-2xx, malformed payload.

---

## Phase 4 — Workspace Manager (Section 9) ✅

### 4.1 `src/workspace/safety.ts`
- `sanitizeWorkspaceKey(identifier: string): string` — replace `[^A-Za-z0-9._-]` with `_`.
- `resolveWorkspacePath(root: string, key: string): string` — join & normalize to absolute.
- `validateWorkspaceContainment(root: string, wsPath: string): void` — assert wsPath under root.

### 4.2 `src/workspace/hooks.ts`
- `runHook(name: string, script: string, cwd: string, timeoutMs: number): Promise<void>`
- Spawn `bash -lc <script>` (or `sh -lc` if bash unavailable) with cwd.
- Kill on timeout.
- Log start, success, failure, timeout.

### 4.3 `src/workspace/manager.ts`
- `WorkspaceManager` class.
- `createForIssue(identifier: string): Promise<Workspace>`
  - Sanitize → resolve path → validate containment.
  - `mkdir -p`; track `created_now`.
  - If `created_now` && `after_create` hook: run hook; on failure remove dir.
- `removeWorkspace(identifier: string): Promise<void>`
  - Run `before_remove` hook (best-effort).
  - Remove directory recursively.

### 4.4 Tests
- Deterministic path for identifier.
- New dir → created_now=true; existing dir → created_now=false.
- Path traversal attempt rejected.
- after_create runs only on new creation.
- before_remove failure → cleanup still proceeds.
- Hook timeout enforced.

---

## Phase 5 — Prompt Renderer (Section 12) ✅

### 5.1 `src/prompt/renderer.ts`
- Use `liquidjs` with `strictVariables: true`, `strictFilters: true`.
- `renderPrompt(template: string, issue: Issue, attempt: number | null): string`
- Convert issue keys to strings for template compatibility.
- Preserve nested arrays (labels, blocked_by).
- Empty template → fallback prompt: `"You are working on a work item from Azure DevOps."`.

### 5.2 Tests
- Render with all issue fields.
- Unknown variable → error.
- Unknown filter → error.
- Empty template → fallback prompt.
- Retry/continuation: `attempt` passed correctly.

---

## Phase 6 — Codex App-Server Client (Section 10) ✅

### 6.1 `src/agent/protocol.ts`
- Types for JSON-RPC messages: `RpcRequest`, `RpcResponse`, `RpcNotification`.
- Line-delimited JSON parser: buffer partial lines, emit complete parsed objects.
- Max line size: 10 MB.

### 6.2 `src/agent/app-server-client.ts`
- `AppServerClient` class.
- `launch(command: string, cwd: string): void`
  - Spawn via `bash -lc <command>` with separate stdout/stderr.
- `initialize(clientInfo, capabilities): Promise<RpcResponse>`
  - Send `initialize` request, wait for response (read_timeout_ms).
- `sendInitialized(): void` — notification.
- `startThread(params): Promise<{ threadId: string }>` — send `thread/start`.
- `startTurn(params): Promise<{ turnId: string }>` — send `turn/start`.
- `streamTurn(onMessage: callback): Promise<TurnResult>`
  - Read stdout lines, parse JSON, detect turn/completed|failed|cancelled.
  - Enforce turn_timeout_ms.
- `stop(): void` — kill subprocess.
- Stderr: log as diagnostics, never parse as protocol.

### 6.3 `src/agent/events.ts`
- Map raw protocol messages → normalized events (Section 10.4).
- Extract session_id, token usage, rate limits.
- Handle approval auto-approve, unsupported tool calls, user-input-required.

### 6.4 `src/agent/tools/ado-api.ts` (optional extension)
- Handle `item/tool/call` for `ado_api` tool name.
- Validate method (GET/POST/PATCH/DELETE), path, body, or wiql shorthand.
- Execute via AdoClient, return structured success/failure.

### 6.5 Tests
- Line parser buffers partial lines correctly.
- Startup handshake sequence: initialize → initialized → thread/start → turn/start.
- turn/completed → success; turn/failed → failure.
- Turn timeout enforced.
- Stderr ignored for protocol parsing.
- Approval auto-approved.
- Unsupported tool call → failure response, session continues.
- User input request → hard failure.
- Token usage extraction from nested payload shapes.

---

## Phase 7 — Agent Runner (Worker) (Sections 10.7, 16.5) ✅

### 7.1 `src/agent/runner.ts`
- `runAgentAttempt(issue, attempt, config, workspaceManager, onEvent): Promise<void>`
- Algorithm:
  1. Create/reuse workspace.
  2. Run `before_run` hook; abort on failure.
  3. Launch app-server, run handshake.
  4. Loop up to `max_turns`:
     a. Build prompt (full on turn 1, continuation guidance on turn 2+).
     b. Start turn; stream events back via `onEvent`.
     c. On turn success: refresh issue state from tracker.
     d. If issue no longer active or turn limit reached: break.
  5. Stop app-server process.
  6. Run `after_run` hook (best-effort).

### 7.2 Tests
- Worker runs full lifecycle: workspace → prompt → handshake → turn → exit.
- Worker retries turn loop up to max_turns.
- Worker stops on non-active issue state mid-loop.
- before_run failure → worker fails, after_run still runs.
- Prompt failure → worker fails immediately.

---

## Phase 8 — Orchestrator (Sections 7–8, 16.1–16.6) ✅

### 8.1 `src/orchestrator/state.ts`
- `createInitialState(config): OrchestratorState`
- Mutation helpers: `addRunning`, `removeRunning`, `addClaimed`, `removeClaimed`, `addRetry`, `removeRetry`, `addCompleted`.

### 8.2 `src/orchestrator/dispatch.ts`
- `sortForDispatch(issues: Issue[]): Issue[]` — priority ASC, created_at ASC, identifier ASC.
- `isEligible(issue, state, config): boolean`
  - Check: required fields, active state, not terminal, not running, not claimed, global slots, per-state slots, blocker rule for `New`.

### 8.3 `src/orchestrator/scheduler.ts`
- `scheduleRetry(state, issueId, attempt, opts): OrchestratorState`
  - Cancel existing timer, compute delay, create timer, store RetryEntry.
  - Continuation retry: 1000 ms fixed.
  - Failure retry: `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`.
- `onRetryTimer(issueId, state, tracker, config): OrchestratorState`
  - Fetch candidates, find issue, dispatch or release.

### 8.4 `src/orchestrator/orchestrator.ts`
- `Orchestrator` class.
- `start()`: validate config, startup cleanup, immediate tick, schedule poll loop.
- `onTick()`:
  1. `reconcileRunningIssues()`.
  2. Validate config; skip dispatch on failure.
  3. Fetch candidates, sort, dispatch eligible.
  4. Notify observers.
- `reconcileRunningIssues()`:
  - Part A: stall detection (kill stalled, queue retry).
  - Part B: tracker state refresh (terminal → stop + clean, active → update, other → stop).
- `dispatchIssue(issue, attempt)`:
  - Claim issue, spawn worker, track in running map.
- `onWorkerExit(issueId, reason)`:
  - Remove running, accumulate runtime.
  - Normal → continuation retry (attempt 1, 1s delay).
  - Abnormal → exponential backoff retry.
- `onCodexUpdate(issueId, event)`: update live session fields.
- `startupTerminalCleanup()`: query terminal issues, remove workspaces.

### 8.5 Tests
- Dispatch sort order: priority, then creation time, then identifier.
- `New` issue with non-terminal blockers → not eligible.
- `New` issue with terminal blockers → eligible.
- Active state refresh updates running entry.
- Terminal state stops worker and cleans workspace.
- Non-active/non-terminal stops worker, no cleanup.
- Normal exit → continuation retry at 1s.
- Abnormal exit → exponential backoff (10s, 20s, 40s, ..., capped at max).
- Stall detection kills and retries.
- Slot exhaustion requeues retry with error.
- Global and per-state concurrency limits respected.

---

## Phase 9 — Structured Logging (Section 13) ✅

### 9.1 `src/observability/logger.ts`
- Structured JSON logger (can use `pino` or a simple custom implementation).
- Context fields: `issue_id`, `issue_identifier`, `session_id`.
- Methods: `info`, `warn`, `error`, `debug`.
- Secrets never logged.

### 9.2 `src/observability/snapshot.ts`
- `buildSnapshot(state: OrchestratorState): RuntimeSnapshot`
- Return running rows (with turn_count), retry rows, codex_totals, rate_limits.
- Compute live seconds_running from started_at.

### 9.3 Tests
- Logger includes context fields.
- Snapshot includes running/retry rows and totals.

---

## Phase 10 — CLI Entry Point (Section 17.7) ✅

### 10.1 `src/index.ts`
- Parse args: optional positional workflow path, optional `--port`.
- Default workflow path: `./WORKFLOW.md`.
- Error on nonexistent file.
- Load workflow, resolve config, create orchestrator, start.
- Handle SIGINT/SIGTERM for graceful shutdown.
- Exit 0 on clean shutdown, nonzero on startup failure.

### 10.2 Tests
- CLI uses `./WORKFLOW.md` when no arg provided.
- CLI uses explicit path when provided.
- Exits nonzero on missing workflow file.

---

## Phase 11 — Optional HTTP Server Extension (Section 13.7) ✅

### 11.1 `src/server/server.ts`
- Start when `--port` or `server.port` is set.
- Bind to `127.0.0.1` by default.
- CLI `--port` overrides `server.port`.

### 11.2 `src/server/routes.ts`
- `GET /api/v1/state` — runtime snapshot JSON.
- `GET /api/v1/:issueIdentifier` — issue-specific debug details (404 if unknown).
- `POST /api/v1/refresh` — trigger immediate poll (202 Accepted).
- `405` for unsupported methods; JSON error envelope.

### 11.3 `src/server/dashboard.ts`
- `GET /` — server-rendered HTML dashboard showing running sessions, retries, totals.

### 11.4 Tests
- `/api/v1/state` returns correct shape.
- `/api/v1/<id>` returns 404 for unknown issue.
- `/api/v1/refresh` returns 202.

---

## Phase 12 — Integration Tests & Example Workflow ✅

### 12.1 Create example `WORKFLOW.md`
```yaml
---
tracker:
  kind: ado
  endpoint: $ADO_ENDPOINT
  api_key: $ADO_PAT
  project_slug: MyProject
  active_states: [New, Active]
  terminal_states: [Closed, Resolved, Done, Cancelled]
polling:
  interval_ms: 30000
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  after_create: |
    git clone $REPO_URL .
  before_run: |
    git fetch && git checkout main && git pull
agent:
  max_concurrent_agents: 5
  max_turns: 20
codex:
  command: codex app-server
  approval_policy: auto-edit
  turn_timeout_ms: 3600000
---
You are working on issue {{ issue.identifier }}: {{ issue.title }}.

{{ issue.description }}

{% if attempt %}This is retry attempt {{ attempt }}.{% endif %}
```

### 12.2 Integration test suite (mocked external services)
- Full orchestrator lifecycle: startup → poll → dispatch → worker run → completion → continuation retry.
- Reconciliation: issue goes terminal mid-run → worker killed, workspace cleaned.
- Retry backoff progression.
- Dynamic workflow reload mid-run.
- Stall detection and recovery.

### 12.3 Real integration profile (optional, requires credentials)
- Smoke test with real ADO endpoint using `ADO_PAT`.
- Skip cleanly when credentials unavailable.

---

## Execution Order for Ralph

Each phase should be executed as a discrete task. Within each phase, implement the code files first, then the tests, then verify tests pass.

**Dependency graph:**
```
Phase 0  →  Phase 1  →  Phase 2  →  Phase 3
                ↓            ↓           ↓
              Phase 5     Phase 4     Phase 6
                ↓            ↓           ↓
              Phase 7  (depends on 4, 5, 6)
                ↓
              Phase 8  (depends on 1, 2, 3, 7)
                ↓
              Phase 9  →  Phase 10  →  Phase 11  →  Phase 12
```

**Suggested serial order:**
1. Phase 0 — Scaffold
2. Phase 1 — Types
3. Phase 2 — Workflow Loader & Config
4. Phase 3 — ADO Client
5. Phase 4 — Workspace Manager
6. Phase 5 — Prompt Renderer
7. Phase 6 — App-Server Client
8. Phase 7 — Agent Runner
9. Phase 8 — Orchestrator
10. Phase 9 — Logging
11. Phase 10 — CLI
12. Phase 11 — HTTP Server
13. Phase 12 — Integration Tests

---

## Trust & Safety Posture (Implementation Decision)

This implementation adopts a **high-trust posture** for the initial version:
- `approval_policy`: `auto-edit` (auto-approve all file changes).
- `thread_sandbox`: `none` or Codex default.
- `turn_sandbox_policy`: Codex default.
- User-input-required: **hard failure** — fail the run attempt immediately.
- Hooks: trusted (run from WORKFLOW.md which is repo-owned).
- Workspace isolation: enforced via path containment checks.

This posture is suitable for trusted environments. Production hardening (sandboxing, restricted hooks, etc.) can be added later per Section 15.5.
