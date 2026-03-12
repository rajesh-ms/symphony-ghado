# Design Decisions

This document captures key design choices and their rationale.

## 1. Single-Process Architecture
**Decision**: No distributed job scheduler; single event-loop daemon.
**Rationale**: Spec Section 2.2 explicitly lists "distributed job scheduler" as a non-goal.
In-memory state avoids database dependencies. Restart recovery is tracker-driven.

## 2. High-Trust Execution Posture
**Decision**: `approval_policy: never`, `sandbox: danger-full-access`.
**Rationale**: Spec Section 15.1 says each implementation defines its trust boundary.
This implementation targets trusted environments where the WORKFLOW.md and tracker
data are controlled by the team. See spec Section 15.5 for hardening guidance.

## 3. WSL-Based Hook Execution on Windows
**Decision**: Hooks always run through `wsl -- bash -c` on Windows.
**Rationale**: WORKFLOW.md hooks use bash syntax (variables, pipes, conditionals).
Running through cmd.exe would require rewriting all hooks for Windows shell.
WSL provides a consistent POSIX environment on Windows.

## 4. Codex via WSL on Windows
**Decision**: When the codex command starts with `wsl`, spawn wsl directly
instead of wrapping in `cmd.exe /c`.
**Rationale**: cmd.exe mangles nested quotes in WSL bash commands. Direct WSL
spawn preserves the command structure. Windows→WSL path conversion handles
the cwd translation automatically.

## 5. Token Extraction from Multiple Event Shapes
**Decision**: `extractUsage()` handles 5+ payload shapes for token counting.
**Rationale**: Codex app-server emits token data under different method names
and nesting structures (`tokenUsage.total` with camelCase, `total_token_usage`
with snake_case, `params.usage`, inline fields). The extractor is lenient
to maximize compatibility across codex versions.

## 6. Dynamic Tools via experimentalApi Capability
**Decision**: Declare `experimentalApi: true` in the initialize handshake to
enable `dynamicTools` in `thread/start`.
**Rationale**: Codex 0.114.0 requires this capability flag to accept dynamic
tool specifications. Without it, `thread/start` with `dynamicTools` fails.

## 7. Extensions Separated from Core
**Decision**: Copilot shim, registry catalog, and MCP config are marked as
extensions with header comments.
**Rationale**: Spec Section 18.2 distinguishes required conformance from
recommended extensions. Clear labeling prevents confusion during spec audits.
