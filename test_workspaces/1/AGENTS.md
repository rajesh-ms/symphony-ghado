# Repository Guide

## Purpose

This repository contains a small TypeScript/Node.js service for maintaining an AI agent registry. The service stores governed agent cards, supports filtered discovery, tracks lifecycle state and heartbeats, and resolves agent names to callable runtime configuration.

## Repository Map

- `src/index.ts`: process entrypoint that starts the HTTP server.
- `src/server.ts`: HTTP routing, request parsing, and error handling.
- `src/agent-registry.ts`: core domain logic for registration, search, authorization, heartbeat handling, and resolution.
- `src/file-registry-store.ts`: file-backed persistence adapter for registry records.
- `src/models.ts`: shared TypeScript model definitions.
- `src/*.test.ts`: unit and integration-style tests for registry behavior and HTTP APIs.
- `README.md`: setup, usage, and example payloads.
- `PLAN.md`: issue-specific acceptance criteria and implementation summary.
- `docs/architecture.md`: service architecture and runtime flow.
- `docs/decisions.md`: design decisions and tradeoffs.

## Build And Test

- Install dependencies: `npm install`
- Run tests: `npm test`
- Run type checks: `npm run check`
- Build production output: `npm run build`
- Start the service from source: `npm run dev`
- Start the built service: `npm start`

## Architecture Summary

- The service uses Node's built-in HTTP server rather than a larger framework to keep the implementation small and dependency-light.
- Registry data is validated and normalized in the domain layer before being persisted.
- Access policies are enforced consistently for search, read, and resolution paths.
- Persistence is file-backed through `data/registry.json`, which keeps the issue self-contained while preserving state across restarts.

## Key Invariants

- An agent is uniquely identified by normalized `name` plus exact `version`.
- All registration payloads must include required agent card, lifecycle, and access-policy metadata.
- Search results and direct reads only return agents visible to the current requester.
- Runtime resolution only returns non-deprecated and non-inactive agents the requester is allowed to invoke.
