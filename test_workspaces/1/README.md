# Agent Marketplace Registry

TypeScript/Node.js service that stores governed AI agent cards, supports discovery with pagination, tracks lifecycle metadata, and resolves an agent name to runtime invocation configuration.

## Features

- `POST /agents`: register an agent card with metadata, lifecycle, and access policy fields
- `GET /agents`: discover agents by tag, capability, use case, owner, status, or deprecation state
- `GET /agents/:name`: fetch all visible versions for an agent, or a specific version with `?version=`
- `POST /agents/:name/:version/heartbeat`: update last heartbeat and optional lifecycle status
- `GET /resolve/:name`: resolve an agent name to a callable runtime configuration for orchestration clients

Registry state persists to `data/registry.json` by default.

## Local usage

```bash
npm install
npm test
npm run build
npm start
```

The server listens on `PORT`, defaulting to `3000`.

## Example registration payload

```json
{
  "name": "summarizer",
  "version": "1.0.0",
  "endpoint": "https://agents.internal/summarizer",
  "supportedProtocols": ["http", "grpc"],
  "inputTypes": ["application/json"],
  "outputTypes": ["application/json"],
  "capabilities": ["summarization"],
  "tags": ["nlp", "internal"],
  "useCases": ["support"],
  "ownerTeam": "platform-ai",
  "authRequirements": {
    "type": "oauth2",
    "scopes": ["agents.invoke"]
  },
  "status": "active",
  "deprecated": false,
  "accessPolicy": {
    "viewers": ["*", "support"],
    "invokers": ["platform-ai", "support"]
  }
}
```
