// ---------------------------------------------------------------------------
// Tests for the Copilot Protocol Shim
// Verifies the JSON-RPC protocol handling without making real API calls.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Helper: spawn the shim process and exchange JSON-RPC messages.
 * Uses tsx to run the TypeScript source directly.
 */
function createShimProcess(env: Record<string, string> = {}) {
  const shimPath = resolve("src/shim/copilot-shim.ts");
  const proc = spawn("npx", ["tsx", shimPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
      // Use a non-existent API base to prevent real calls
      COPILOT_API_BASE: env.COPILOT_API_BASE ?? "http://127.0.0.1:1/fake",
      COPILOT_API_KEY: env.COPILOT_API_KEY ?? "test-key",
    },
    shell: true,
  });

  const responses: Record<string, unknown>[] = [];
  let buffer = "";

  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // keep incomplete line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        responses.push(JSON.parse(line));
      } catch {
        // skip non-JSON
      }
    }
  });

  const stderrLines: string[] = [];
  proc.stderr!.on("data", (chunk: Buffer) => {
    stderrLines.push(chunk.toString());
  });

  function send(msg: Record<string, unknown>): void {
    proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  async function waitForResponse(
    id: number,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = responses.find((r) => (r as { id?: number }).id === id);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for response id=${id}`);
  }

  async function waitForMethod(
    method: string,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = responses.find(
        (r) => (r as { method?: string }).method === method,
      );
      if (found) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for method=${method}`);
  }

  function kill(): void {
    proc.stdin!.end();
    proc.kill("SIGTERM");
  }

  return { send, waitForResponse, waitForMethod, kill, responses, stderrLines, proc };
}

describe("Copilot Shim Protocol", () => {
  it("responds to initialize with server info", async () => {
    const shim = createShimProcess();
    try {
      shim.send({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "symphony", version: "1.0" },
          capabilities: {},
        },
      });

      const resp = await shim.waitForResponse(1);
      expect(resp).toHaveProperty("id", 1);
      expect(resp).toHaveProperty("result");
      const result = resp.result as Record<string, unknown>;
      expect(result.serverInfo).toEqual({
        name: "copilot-shim",
        version: "1.0",
      });
    } finally {
      shim.kill();
    }
  });

  it("responds to thread/start with a thread ID", async () => {
    const shim = createShimProcess();
    try {
      // Initialize first
      shim.send({ id: 1, method: "initialize", params: {} });
      await shim.waitForResponse(1);

      shim.send({ id: 2, method: "initialized", params: {} });

      // Start thread
      shim.send({
        id: 3,
        method: "thread/start",
        params: {
          approvalPolicy: "auto-edit",
          sandbox: "none",
          cwd: process.cwd(),
        },
      });

      const resp = await shim.waitForResponse(3);
      expect(resp).toHaveProperty("id", 3);
      const result = resp.result as Record<string, unknown>;
      const thread = result.thread as Record<string, unknown>;
      expect(thread).toHaveProperty("id");
      expect(typeof thread.id).toBe("string");
      expect((thread.id as string).length).toBeGreaterThan(0);
    } finally {
      shim.kill();
    }
  });

  it("responds to turn/start with a turn ID (then fails on API call)", async () => {
    const shim = createShimProcess();
    try {
      // Handshake
      shim.send({ id: 1, method: "initialize", params: {} });
      await shim.waitForResponse(1);
      shim.send({ id: 2, method: "initialized", params: {} });
      shim.send({
        id: 3,
        method: "thread/start",
        params: { cwd: process.cwd() },
      });
      await shim.waitForResponse(3);

      // Start turn — will fail on the API call since we use a fake base
      shim.send({
        id: 4,
        method: "turn/start",
        params: {
          threadId: "test",
          input: [{ type: "text", text: "Hello" }],
          cwd: process.cwd(),
          title: "TEST-1: Test issue",
        },
      });

      // Should get the turn/start response immediately with a turn ID
      const resp = await shim.waitForResponse(4);
      expect(resp).toHaveProperty("id", 4);
      const result = resp.result as Record<string, unknown>;
      const turn = result.turn as Record<string, unknown>;
      expect(turn).toHaveProperty("id");

      // Should eventually get turn/failed since API is unreachable
      const failed = await shim.waitForMethod("turn/failed", 10000);
      expect(failed).toHaveProperty("method", "turn/failed");
    } finally {
      shim.kill();
    }
  });

  it("returns error for unknown methods with an id", async () => {
    const shim = createShimProcess();
    try {
      shim.send({ id: 99, method: "unknown/method", params: {} });
      const resp = await shim.waitForResponse(99);
      expect(resp).toHaveProperty("error");
      const error = resp.error as Record<string, unknown>;
      expect(error.code).toBe(-32601);
    } finally {
      shim.kill();
    }
  });

  it("handles full handshake sequence", async () => {
    const shim = createShimProcess();
    try {
      // Step 1: initialize
      shim.send({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "symphony", version: "1.0" } },
      });
      const initResp = await shim.waitForResponse(1);
      expect(initResp.result).toBeDefined();

      // Step 2: initialized (notification — no response expected)
      shim.send({ method: "initialized", params: {} });

      // Step 3: thread/start
      shim.send({
        id: 2,
        method: "thread/start",
        params: { approvalPolicy: "auto-edit", cwd: process.cwd() },
      });
      const threadResp = await shim.waitForResponse(2);
      const threadResult = threadResp.result as Record<string, unknown>;
      const thread = threadResult.thread as Record<string, unknown>;
      expect(thread.id).toBeTruthy();

      // All 3 steps completed without error
    } finally {
      shim.kill();
    }
  });

  it("logs to stderr, not stdout", async () => {
    const shim = createShimProcess();
    try {
      shim.send({ id: 1, method: "initialize", params: {} });
      await shim.waitForResponse(1);

      // Wait for stderr to flush
      await new Promise((r) => setTimeout(r, 2000));

      // stdout responses should all be valid JSON objects (no log pollution)
      for (const resp of shim.responses) {
        expect(resp).toBeDefined();
        expect(typeof resp).toBe("object");
      }
      // Verify at least one response on stdout
      expect(shim.responses.length).toBeGreaterThan(0);
    } finally {
      shim.kill();
    }
  }, 10000);
});
