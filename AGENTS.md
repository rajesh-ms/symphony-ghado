# AGENTS.md — Navigation Guide for AI Agents

> This file is the entry point for any coding agent working on this repository.
> Read this first to understand what Symphony is, where things live, and how to work safely.

## What Is Symphony?

Symphony is a long-running automation service that polls Azure DevOps for work items,
creates isolated per-issue workspaces, and runs a coding agent (Codex) against each issue.
The full product specification lives in `.github/instructions/prodspec.instructions.md`.

## Repository Map

### Core Source (`src/`)

| Path | Purpose | Spec Section |
|------|---------|--------------|
| `src/index.ts` | CLI entry point — parses args, starts orchestrator | 17.7 |
| `src/types.ts` | All domain model types and normalization helpers | 4 |
| `src/logging.ts` | Structured logger (pino) | 13.1 |
| `src/config/workflow-loader.ts` | Parses `WORKFLOW.md` (YAML front matter + prompt) | 5 |
| `src/config/config.ts` | Typed config resolution with defaults and `$VAR` expansion | 6 |
| `src/config/validation.ts` | Dispatch preflight validation | 6.3 |
| `src/config/watcher.ts` | Watches `WORKFLOW.md` for live reload | 6.2 |
| `src/tracker/ado-client.ts` | Azure DevOps REST client (WIQL, batch fetch) | 11 |
| `src/tracker/normalize.ts` | ADO payload → normalized Issue model | 11.3 |
| `src/tracker/types.ts` | TrackerClient interface | 11.1 |
| `src/orchestrator/orchestrator.ts` | Poll loop, dispatch, reconciliation, retry | 7–8 |
| `src/orchestrator/state.ts` | Pure state helpers (eligibility, sorting, backoff) | 7–8 |
| `src/workspace/manager.ts` | Per-issue workspace create/reuse/clean | 9 |
| `src/workspace/hooks.ts` | Shell hook execution with timeout | 9.4 |
| `src/workspace/safety.ts` | Path sanitization and containment checks | 9.5 |
| `src/prompt/renderer.ts` | Liquid template rendering (strict mode) | 12 |
| `src/agent/app-server-client.ts` | Codex app-server JSON-RPC client over stdio | 10 |
| `src/agent/runner.ts` | Worker lifecycle (workspace → prompt → multi-turn) | 10.7 |
| `src/agent/protocol.ts` | Protocol message types | 10.1 |
| `src/agent/events.ts` | Event classification and token extraction | 10.4 |
| `src/agent/tools/ado-api.ts` | Optional `ado_api` client-side tool extension | 10.5 |

### Extensions (not required for spec conformance)

| Path | Purpose |
|------|---------|
| `src/shim/copilot-shim.ts` | Protocol adapter: OpenAI-compatible API ↔ Codex protocol |
| `src/registry/catalog.ts` | Static agent/MCP server registry catalog |
| `src/server/server.ts` | HTTP dashboard and REST API (`/api/v1/*`) |
| `src/server/registry-page.ts` | Registry HTML page renderer |

### Tests (`tests/`)

| Path | Coverage |
|------|----------|
| `tests/unit/types.test.ts` | Domain model helpers |
| `tests/unit/config.test.ts` | Config resolution, env vars, defaults, validation |
| `tests/unit/tracker.test.ts` | ADO normalization, WIQL, pagination |
| `tests/unit/workspace.test.ts` | Workspace creation, hooks, safety |
| `tests/unit/prompt.test.ts` | Template rendering, strict mode |
| `tests/unit/agent.test.ts` | Protocol parsing, events, tool calls |
| `tests/unit/orchestrator.test.ts` | Dispatch, reconciliation, retry, concurrency |
| `tests/unit/server.test.ts` | HTTP API routes |
| `tests/unit/shim.test.ts` | Copilot shim protocol |
| `tests/unit/registry.test.ts` | Registry catalog |
| `tests/integration/orchestrator.test.ts` | End-to-end lifecycle with mocks |

### Key Config Files

| File | Purpose |
|------|---------|
| `WORKFLOW.md` | Active workflow definition (tracker config + prompt template) |
| `WORKFLOW.md.example` | Documented example workflow |
| `PLAN.md` | Implementation plan with phase completion status |
| `.github/instructions/prodspec.instructions.md` | Full product specification |
| `package.json` | Dependencies, scripts (`build`, `test`, `dev`, `start`) |
| `tsconfig.json` | TypeScript config (strict, ES2022, Node16) |

## Build & Run

```bash
npm install          # install deps
npm run build        # tsc → dist/
npm test             # vitest run (144 tests)
npm run dev          # tsx src/index.ts (no build needed)
npm start            # node dist/index.js
```

## Architecture Summary

```
WORKFLOW.md ──→ Workflow Loader ──→ Config Layer ──→ Orchestrator
                                                       │
                         ┌─────────────────────────────┤
                         ▼                             ▼
                   ADO Tracker Client          Workspace Manager
                   (poll / reconcile)          (create / hooks / clean)
                         │                             │
                         ▼                             ▼
                   Issue Queue ──→ Agent Runner ──→ Codex App-Server
                                   (multi-turn)     (JSON-RPC/stdio)
```

## Constraints & Safety

- **Workspace isolation**: Agent cwd must be inside workspace root (enforced in `safety.ts`)
- **Approval policy**: `never` = auto-approve all (high-trust mode)
- **Sandbox**: `danger-full-access` for full filesystem access
- **Hooks**: Trusted — run from WORKFLOW.md which is repo-owned
- **Secrets**: `$VAR` indirection; never logged

## Where to Look For...

| Question | Start Here |
|----------|------------|
| How issues are fetched from ADO | `src/tracker/ado-client.ts` |
| How dispatch priority works | `src/orchestrator/state.ts` → `sortForDispatch` |
| How the agent subprocess is launched | `src/agent/app-server-client.ts` → `launch()` |
| How the prompt is built | `src/prompt/renderer.ts` + WORKFLOW.md body |
| How retries work | `src/orchestrator/orchestrator.ts` → `scheduleRetry` |
| How token usage is tracked | `src/agent/events.ts` → `extractUsage` |
| How hooks run on Windows/WSL | `src/workspace/hooks.ts` |
| Full spec for any behavior | `.github/instructions/prodspec.instructions.md` |
