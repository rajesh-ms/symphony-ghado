# Architecture

Symphony is a single-process Node.js daemon that orchestrates coding agents against
Azure DevOps work items. This document describes the runtime architecture.

## Layers

The system is organized into six layers per the product specification:

### 1. Policy Layer (repo-defined)
- `WORKFLOW.md` prompt body and front-matter config
- Owned by the team, versioned with the repo

### 2. Configuration Layer
- `src/config/workflow-loader.ts` — parses WORKFLOW.md
- `src/config/config.ts` — resolves typed config with defaults,  `$VAR` expansion
- `src/config/validation.ts` — preflight checks before dispatch
- `src/config/watcher.ts` — live reload on file change

### 3. Coordination Layer (orchestrator)
- `src/orchestrator/orchestrator.ts` — poll loop, dispatch, reconciliation
- `src/orchestrator/state.ts` — pure state functions (eligibility, sorting, backoff)

### 4. Execution Layer (workspace + agent)
- `src/workspace/` — filesystem lifecycle, hooks, path safety
- `src/agent/runner.ts` — worker: workspace → prompt → multi-turn agent session
- `src/agent/app-server-client.ts` — Codex JSON-RPC subprocess client

### 5. Integration Layer (Azure DevOps adapter)
- `src/tracker/ado-client.ts` — WIQL queries, batch fetch, Basic auth
- `src/tracker/normalize.ts` — ADO fields → normalized Issue model

### 6. Observability Layer
- `src/logging.ts` — structured pino logger
- `src/server/server.ts` — HTTP dashboard + REST API (extension)

## Data Flow

```
                    ┌──────────────────┐
                    │   WORKFLOW.md    │
                    │  (config+prompt) │
                    └────────┬─────────┘
                             │ parse + watch
                             ▼
┌──────────┐    ┌────────────────────────┐    ┌─────────────────┐
│  Azure   │◄──│     Orchestrator       │──►│   Workspace     │
│  DevOps  │   │  (poll/dispatch/retry)  │   │   Manager       │
│  (ADO)   │──►│                        │   │  (create/hooks) │
└──────────┘    └───────────┬────────────┘    └────────┬────────┘
                            │ spawn worker              │ cwd
                            ▼                           ▼
                  ┌──────────────────┐      ┌──────────────────┐
                  │  Agent Runner    │──────│  Codex Process   │
                  │  (multi-turn)    │stdin │  (app-server)    │
                  │                  │◄────│  JSON-RPC/stdio  │
                  └──────────────────┘stdout└──────────────────┘
```

## Concurrency Model

- Single Node.js event loop — no threads or child orchestrators
- Workers are async tasks (Promises), not separate processes
- The orchestrator serializes all state mutations through one authority
- Codex subprocesses are the only child processes (one per active issue)
- Global and per-state concurrency limits are enforced before dispatch

## State Machine

Issue orchestration states (internal, not tracker states):

```
Unclaimed → Claimed → Running → Released
                  ↓         ↗
              RetryQueued ─┘
```

- `Claimed` prevents duplicate dispatch
- `Running` = worker task active + tracked in running map
- `RetryQueued` = waiting for backoff timer
- `Released` = claim removed (terminal, non-active, or retry exhausted)

## Key Invariants

1. Agent cwd must equal the per-issue workspace path
2. Workspace path must be inside workspace root
3. Workspace directory names use sanitized identifiers only (`[A-Za-z0-9._-]`)
4. Secrets are never logged
5. Hook timeouts are enforced to prevent orchestrator hangs
