import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AccessDeniedError, AgentRegistry, NotFoundError, ValidationError } from "./agent-registry.js";
import { FileRegistryStore } from "./file-registry-store.js";
import type { AgentCardInput } from "./models.js";

function buildAgent(overrides: Partial<AgentCardInput> = {}): AgentCardInput {
  return {
    name: "summarizer",
    version: "1.0.0",
    endpoint: "https://agents.internal/summarizer",
    supportedProtocols: ["http", "grpc"],
    inputTypes: ["application/json"],
    outputTypes: ["application/json"],
    capabilities: ["summarization", "classification"],
    tags: ["nlp", "internal"],
    useCases: ["support", "knowledge-base"],
    ownerTeam: "platform-ai",
    authRequirements: {
      type: "oauth2",
      scopes: ["agents.invoke"],
    },
    status: "active",
    deprecated: false,
    accessPolicy: {
      viewers: ["*", "sales"],
      invokers: ["platform-ai", "sales"],
    },
    ...overrides,
  };
}

function createRegistry() {
  const dir = mkdtempSync(join(tmpdir(), "agent-registry-"));
  const storePath = join(dir, "registry.json");
  const registry = new AgentRegistry({ store: new FileRegistryStore(storePath) });

  return {
    dir,
    storePath,
    registry,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("registers agents, searches with pagination, and enforces visibility policies", () => {
  const { registry, cleanup } = createRegistry();

  try {
    registry.register(buildAgent());
    registry.register(
      buildAgent({
        name: "planner",
        version: "2.1.0",
        endpoint: "https://agents.internal/planner",
        capabilities: ["planning"],
        tags: ["automation"],
        useCases: ["operations"],
        ownerTeam: "workflow-ai",
        accessPolicy: {
          viewers: ["workflow-ai"],
          invokers: ["workflow-ai"],
        },
      }),
    );

    const publicSearch = registry.search({
      tag: "nlp",
      capability: "summarization",
      useCase: "support",
      owner: "platform-ai",
      requester: "sales",
      page: 1,
      pageSize: 1,
    });

    assert.equal(publicSearch.total, 1);
    assert.equal(publicSearch.totalPages, 1);
    assert.equal(publicSearch.items[0]?.name, "summarizer");

    const hiddenSearch = registry.search({ requester: "sales" });
    assert.equal(hiddenSearch.total, 1);
    assert.equal(hiddenSearch.items[0]?.name, "summarizer");
  } finally {
    cleanup();
  }
});

test("resolves latest callable agent version and excludes inactive or deprecated variants", () => {
  const { registry, cleanup } = createRegistry();

  try {
    registry.register(buildAgent({ version: "1.0.0", deprecated: true }));
    registry.register(buildAgent({ version: "1.1.0", status: "inactive" }));
    registry.register(buildAgent({ version: "1.2.0", endpoint: "https://agents.internal/summarizer-v1-2" }));

    const resolved = registry.resolve("summarizer", { requester: "sales" });

    assert.equal(resolved.version, "1.2.0");
    assert.equal(resolved.endpoint, "https://agents.internal/summarizer-v1-2");
    assert.deepEqual(resolved.supportedProtocols, ["http", "grpc"]);
    assert.throws(() => registry.resolve("summarizer", { requester: "anonymous" }), AccessDeniedError);
  } finally {
    cleanup();
  }
});

test("updates lifecycle metadata from heartbeat events and persists records", () => {
  const { registry, storePath, cleanup } = createRegistry();

  try {
    registry.register(buildAgent({ lastHeartbeat: "2026-03-10T00:00:00.000Z" }));

    const updated = registry.recordHeartbeat("summarizer", "1.0.0", {
      timestamp: "2026-03-12T10:15:30.000Z",
      status: "degraded",
    });

    assert.equal(updated.lastHeartbeat, "2026-03-12T10:15:30.000Z");
    assert.equal(updated.status, "degraded");

    const stored = JSON.parse(readFileSync(storePath, "utf8")) as Array<{ lastHeartbeat: string; status: string }>;
    assert.equal(stored[0]?.lastHeartbeat, "2026-03-12T10:15:30.000Z");
    assert.equal(stored[0]?.status, "degraded");
  } finally {
    cleanup();
  }
});

test("reloads persisted agents from the file-backed store", () => {
  const { registry, storePath, cleanup } = createRegistry();

  try {
    registry.register(buildAgent());

    const reloaded = new AgentRegistry({ store: new FileRegistryStore(storePath) });
    const matches = reloaded.getByName("summarizer", "sales");

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.name, "summarizer");
  } finally {
    cleanup();
  }
});

test("validates registration payloads and missing agents", () => {
  const { registry, cleanup } = createRegistry();

  try {
    assert.throws(
      () =>
        registry.register(
          buildAgent({
            endpoint: "ftp://not-allowed",
          }),
        ),
      ValidationError,
    );

    assert.throws(() => registry.get("missing", "1.0.0"), NotFoundError);
  } finally {
    cleanup();
  }
});
