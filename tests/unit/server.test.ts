// ---------------------------------------------------------------------------
// Tests for HTTP Server — Section 13.7
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createApp } from "../../src/server/server.js";
import type { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type { OrchestratorSnapshot, IssueDetail } from "../../src/orchestrator/orchestrator.js";
import pino from "pino";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const logger = pino({ level: "silent" });

function makeSnapshot(overrides: Partial<OrchestratorSnapshot> = {}): OrchestratorSnapshot {
  return {
    generated_at: "2026-02-24T20:15:30Z",
    counts: { running: 0, retrying: 0 },
    running: [],
    retrying: [],
    codex_totals: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      seconds_running: 0,
    },
    rate_limits: null,
    ...overrides,
  };
}

function makeMockOrchestrator(
  snapshot: OrchestratorSnapshot = makeSnapshot(),
  issueDetail: IssueDetail | null = null,
): Orchestrator {
  return {
    getSnapshot: () => snapshot,
    findIssueByIdentifier: (_id: string) => issueDetail,
    triggerRefresh: async () => {},
  } as unknown as Orchestrator;
}

function fetch(server: http.Server, path: string, method = "GET"): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HTTP Server", () => {
  let server: http.Server;
  let orchestrator: Orchestrator;

  beforeAll(async () => {
    orchestrator = makeMockOrchestrator();
    server = createApp(orchestrator, logger);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  // --- GET / dashboard ---

  it("GET / returns HTML dashboard", async () => {
    const res = await fetch(server, "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Symphony");
    expect(res.body).toContain("<!DOCTYPE html>");
    expect(res.body).toContain("Open AI agent registry");
  });

  it("GET /registry returns HTML registry page", async () => {
    const res = await fetch(server, "/registry");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Symphony Agent Registry");
    expect(res.body).toContain("AI Agent Marketplace");
    expect(res.body).toContain("Search by name, tag, capability, or use case");
    expect(res.body).toContain("MCP Server");
  });

  // --- GET /api/v1/state ---

  it("GET /api/v1/state returns JSON snapshot", async () => {
    const res = await fetch(server, "/api/v1/state");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const data = JSON.parse(res.body);
    expect(data.generated_at).toBeDefined();
    expect(data.counts).toEqual({ running: 0, retrying: 0 });
    expect(data.running).toEqual([]);
    expect(data.retrying).toEqual([]);
    expect(data.codex_totals).toBeDefined();
  });

  it("GET /api/v1/registry returns JSON registry data", async () => {
    const res = await fetch(server, "/api/v1/registry");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const data = JSON.parse(res.body);
    expect(data.counts).toEqual({
      total: 6,
      agents: 3,
      mcp_servers: 3,
    });
    expect(data.entries).toHaveLength(6);
    expect(data.entries.some((entry: { type: string; name: string }) => entry.type === "agent" && entry.name === "CodePilot")).toBe(true);
    expect(data.entries.some((entry: { type: string; name: string }) => entry.type === "mcp_server" && entry.name === "Azure DevOps Tracker")).toBe(true);
  });

  // --- POST /api/v1/refresh ---

  it("POST /api/v1/refresh returns 202 accepted", async () => {
    const res = await fetch(server, "/api/v1/refresh", "POST");
    expect(res.status).toBe(202);
    const data = JSON.parse(res.body);
    expect(data.queued).toBe(true);
    expect(data.operations).toEqual(["poll", "reconcile"]);
  });

  it("GET /api/v1/refresh returns 405", async () => {
    const res = await fetch(server, "/api/v1/refresh", "GET");
    expect(res.status).toBe(405);
    const data = JSON.parse(res.body);
    expect(data.error.code).toBe("method_not_allowed");
  });

  // --- GET /api/v1/:identifier ---

  it("GET /api/v1/MT-123 returns 404 when not found", async () => {
    const res = await fetch(server, "/api/v1/MT-123");
    expect(res.status).toBe(404);
    const data = JSON.parse(res.body);
    expect(data.error.code).toBe("issue_not_found");
  });

  // --- 404 for unknown routes ---

  it("GET /unknown returns 404", async () => {
    const res = await fetch(server, "/unknown");
    expect(res.status).toBe(404);
    const data = JSON.parse(res.body);
    expect(data.error.code).toBe("not_found");
  });

  // --- OPTIONS for CORS ---

  it("OPTIONS returns 204 with CORS headers", async () => {
    const res = await fetch(server, "/api/v1/state", "OPTIONS");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("HTTP Server — issue detail", () => {
  let server: http.Server;

  beforeAll(async () => {
    const detail: IssueDetail = {
      issue_identifier: "MT-649",
      issue_id: "abc123",
      status: "running",
      workspace: { path: "/tmp/ws/MT-649" },
      running: {
        session_id: "t1-turn1",
        turn_count: 3,
        state: "Active",
        started_at: "2026-02-24T20:10:12Z",
        last_event: "notification",
        last_message: "Working",
        last_event_at: "2026-02-24T20:14:59Z",
        tokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      },
      retry: null,
    };
    const orch = makeMockOrchestrator(makeSnapshot(), detail);
    server = createApp(orch, logger);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /api/v1/MT-649 returns issue detail", async () => {
    const res = await fetch(server, "/api/v1/MT-649");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.issue_identifier).toBe("MT-649");
    expect(data.status).toBe("running");
    expect(data.running.session_id).toBe("t1-turn1");
    expect(data.running.tokens.total_tokens).toBe(150);
  });
});
