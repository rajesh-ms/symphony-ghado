# Architecture

## Overview

The registry is a single-process TypeScript/Node.js service with three main layers:

1. HTTP transport
2. Registry domain logic
3. File-backed persistence

The service is designed to satisfy the issue requirements without external infrastructure. It provides an API surface that other marketplace services can call to register agents, discover them, inspect lifecycle metadata, and resolve runtime connection details.

## Layers

### HTTP Layer

`src/server.ts` owns route matching, query parsing, request-body decoding, and JSON responses. It converts request input into domain-layer calls and maps domain exceptions to HTTP status codes.

Routes:

- `POST /agents`
- `GET /agents`
- `GET /agents/:name`
- `POST /agents/:name/:version/heartbeat`
- `GET /resolve/:name`

### Domain Layer

`src/agent-registry.ts` contains all business behavior:

- Normalize and validate agent registrations
- Reject duplicate `name@version` pairs
- Filter search results by tags, capabilities, use cases, owner, lifecycle state, and deprecation
- Enforce access policy for both visibility and invocation
- Update heartbeat timestamps and lifecycle state
- Resolve the best callable agent version for orchestration clients

This layer is intentionally transport-agnostic and can be reused by another API surface later.

### Persistence Layer

`src/file-registry-store.ts` persists registry records to `data/registry.json`. Saves are written through a temporary file and renamed into place, reducing the chance of a partially written registry file if the process exits mid-write.

## Data Flow

### Registration

1. Client posts an agent card to `POST /agents`.
2. HTTP layer parses JSON.
3. Domain layer validates and normalizes the payload.
4. Registry checks for duplicate `name@version`.
5. Store persists the full record.
6. Created record is returned to the caller.

### Discovery

1. Client queries `GET /agents` with filters.
2. HTTP layer parses filter and pagination parameters.
3. Domain layer filters records and enforces visibility policy.
4. Paginated results are returned.

### Runtime Resolution

1. Client calls `GET /resolve/:name`.
2. Domain layer filters candidate versions by requester, lifecycle state, and deprecation.
3. Highest version that remains callable is returned as runtime configuration.

## Concurrency Model

The current service runs in a single Node.js process. Registry state is stored in memory and persisted synchronously after mutations. This keeps behavior deterministic for the scope of the issue. If the service later runs across multiple replicas, the file-backed store should be replaced with a shared database or transactional registry backend.

## Operational Notes

- Default persistence path: `data/registry.json`
- Default port: `3000`
- Tests use isolated temporary registry files to avoid cross-test contamination.

## Invariants

- Every stored agent record has a generated `id`, `createdAt`, and `updatedAt`.
- `lastHeartbeat`, when present, must be a valid ISO-8601 timestamp.
- `accessPolicy.viewers` and `accessPolicy.invokers` must each contain at least one principal or `*`.
- Resolution never returns agents marked `inactive` or `deprecated`.
