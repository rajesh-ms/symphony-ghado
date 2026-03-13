# Design Decisions

## 1. Use plain Node.js HTTP instead of a framework

### Decision

Use Node's built-in `http` module rather than introducing Fastify or Express.

### Rationale

- The required API surface is small.
- Fewer dependencies reduce setup and failure modes in the isolated workspace.
- The issue can be delivered with a compact implementation that is easy to audit.

### Alternative considered

Fastify would provide schema hooks and plugins, but it would add dependencies and framework structure that are not necessary for this issue.

## 2. Use a file-backed registry store

### Decision

Persist agent records in `data/registry.json`.

### Rationale

- The issue description does not require a database.
- File persistence preserves state across restarts and demonstrates a complete registration flow.
- It keeps local development and testing simple.

### Alternative considered

An in-memory-only store would be simpler but would lose state on restart and undershoot the requirement for a usable registry service.

## 3. Enforce access policy in the domain layer

### Decision

Apply visibility and invocation checks inside `AgentRegistry`, not in route handlers.

### Rationale

- Authorization behavior stays consistent across search, direct lookup, and runtime resolution.
- The domain layer remains reusable if another transport is introduced later.

### Alternative considered

Placing checks in the HTTP layer would couple security rules to one transport and risk inconsistent behavior across entry points.

## 4. Resolve the highest callable version at runtime

### Decision

When no version is requested, choose the highest version that is visible, invokable, not deprecated, and not inactive.

### Rationale

- This matches the orchestration requirement to resolve a stable agent name to a usable runtime configuration.
- It avoids selecting stale or intentionally retired versions.

### Alternative considered

Requiring callers to always specify an exact version would simplify resolution logic but would reduce discoverability and push more policy handling to clients.
