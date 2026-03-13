# PLAN

## User Story Summary

Build an AI agent registry service that lets platform teams register governed agent cards, search and discover agents through filtered and paginated APIs, track lifecycle metadata such as status and heartbeat health, and resolve a stable agent name into runtime invocation configuration for downstream orchestration clients.

## Acceptance Criteria Checklist

- [x] API to register agents with an “Agent Card” (name, version, endpoint, supported protocols, input/output types, capabilities/tags, owner/team, auth requirements).
- [x] Discovery/search API to find agents by tag, capability, use case, or owner, with pagination.
- [x] Metadata includes lifecycle info (status, last heartbeat, deprecation flag) and access policies (who can see/use each agent).
- [x] Registry integrates with your orchestration layer so that clients can resolve an agent name → callable endpoint/config at runtime.

## Implementation Summary

- Created a TypeScript/Node.js service with build, dev, start, check, and test scripts.
- Modeled an Agent Card contract with governance, lifecycle, authentication, and access-policy fields in `src/models.ts`.
- Implemented a file-backed registry store that persists registrations to `data/registry.json`.
- Added registry service logic for registration, duplicate protection, visibility-aware lookup, search, heartbeat updates, and runtime resolution.
- Exposed REST endpoints for registration, listing/search with pagination, agent lookup, heartbeat updates, and orchestration resolution.
- Added automated tests covering registration, filtering, pagination, lifecycle heartbeat updates, persistence reloads, and runtime resolution.
- Documented setup, API usage, and payload examples in `README.md`.

## Assumptions

- A local file-backed registry is acceptable for this issue and stands in for an external database.
- Access policies are represented as allow-list style visibility and usage scopes, not as live IAM enforcement hooks.
- Orchestration integration is satisfied by exposing a resolution API and a resolver module that returns callable runtime configuration for the selected agent/version.
- The ADO integration steps in the workflow are currently blocked because the provided `ado_api` helper is returning invalid responses in this session.
- The required workspace `SKILL.md` was not present, so the workflow was followed using the available local plan/progress files instead.
