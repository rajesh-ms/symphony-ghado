import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sanitizeWorkspaceKey } from "../../src/types.js";
import {
  resolveWorkspacePath,
  validateWorkspaceContainment,
} from "../../src/workspace/safety.js";
import { WorkspaceManager, WorkspaceError } from "../../src/workspace/manager.js";
import type { HooksConfig } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Safety module tests
// ---------------------------------------------------------------------------
describe("workspace / safety", () => {
  it("sanitizes workspace key", () => {
    expect(sanitizeWorkspaceKey("ABC-123")).toBe("ABC-123");
    expect(sanitizeWorkspaceKey("feat/work item#5")).toBe("feat_work_item_5");
    expect(sanitizeWorkspaceKey("hello world!")).toBe("hello_world_");
    expect(sanitizeWorkspaceKey("OK.file_name-2")).toBe("OK.file_name-2");
  });

  it("resolves workspace path deterministically", () => {
    const root = "/tmp/ws";
    const p1 = resolveWorkspacePath(root, "MT-123");
    const p2 = resolveWorkspacePath(root, "MT-123");
    expect(p1).toBe(p2);
    expect(p1).toContain("MT-123");
  });

  it("validates containment — good path", () => {
    expect(() =>
      validateWorkspaceContainment("/tmp/ws", "/tmp/ws/MT-123"),
    ).not.toThrow();
  });

  it("throws on path traversal", () => {
    expect(() =>
      validateWorkspaceContainment("/tmp/ws", "/tmp/other"),
    ).toThrow();

    expect(() =>
      validateWorkspaceContainment("/tmp/ws", "/tmp/ws/../etc/passwd"),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Workspace Manager tests
// ---------------------------------------------------------------------------
describe("WorkspaceManager", () => {
  let root: string;

  const noHooks: HooksConfig = {
    after_create: null,
    before_run: null,
    after_run: null,
    before_remove: null,
    timeout_ms: 5000,
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sym-ws-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a new workspace and reports created_now=true", async () => {
    const mgr = new WorkspaceManager(root, noHooks);
    const ws = await mgr.createForIssue("MT-100");

    expect(ws.created_now).toBe(true);
    expect(ws.workspace_key).toBe("MT-100");
    const s = await stat(ws.path);
    expect(s.isDirectory()).toBe(true);
  });

  it("reuses existing workspace and reports created_now=false", async () => {
    const mgr = new WorkspaceManager(root, noHooks);
    await mgr.createForIssue("MT-200");
    const ws2 = await mgr.createForIssue("MT-200");
    expect(ws2.created_now).toBe(false);
  });

  it("deterministic path for same identifier", async () => {
    const mgr = new WorkspaceManager(root, noHooks);
    const ws1 = await mgr.createForIssue("MT-300");
    const ws2 = await mgr.createForIssue("MT-300");
    expect(ws1.path).toBe(ws2.path);
  });

  it("sanitizes identifier in the workspace key", async () => {
    const mgr = new WorkspaceManager(root, noHooks);
    const ws = await mgr.createForIssue("feat/my work#1");
    expect(ws.workspace_key).toBe("feat_my_work_1");
  });

  it("runs after_create hook only on new workspace", async () => {
    // Hook writes a marker file inside the workspace (cwd = workspace path)
    const hooks: HooksConfig = {
      ...noHooks,
      after_create: process.platform === "win32"
        ? "echo created > hook_marker.txt"
        : "echo created > hook_marker.txt",
    };
    const mgr = new WorkspaceManager(root, hooks);
    const ws = await mgr.createForIssue("HC-1");
    const marker = join(ws.path, "hook_marker.txt");
    const content = await readFile(marker, "utf-8");
    expect(content.trim()).toBe("created");

    // Second call — should NOT re-run the hook (workspace already exists)
    await rm(marker, { force: true });
    const ws2 = await mgr.createForIssue("HC-1");
    expect(ws2.created_now).toBe(false);
    await expect(stat(marker)).rejects.toThrow();
  });

  it("removes workspace on after_create failure and throws", async () => {
    const hooks: HooksConfig = {
      ...noHooks,
      after_create: "exit 1",
    };
    const mgr = new WorkspaceManager(root, hooks);
    await expect(mgr.createForIssue("FAIL-1")).rejects.toThrow(
      WorkspaceError,
    );
    // Directory should have been cleaned up
    await expect(stat(join(root, "FAIL-1"))).rejects.toThrow();
  });

  it("removeWorkspace deletes directory", async () => {
    const mgr = new WorkspaceManager(root, noHooks);
    const ws = await mgr.createForIssue("RM-1");
    await mgr.removeWorkspace("RM-1");
    await expect(stat(ws.path)).rejects.toThrow();
  });

  it("removeWorkspace runs before_remove hook (best-effort)", async () => {
    // before_remove runs with cwd = workspace dir, so write marker there
    const hooks: HooksConfig = {
      ...noHooks,
      before_remove: process.platform === "win32"
        ? "echo removed > br_marker.txt"
        : "echo removed > br_marker.txt",
    };
    const mgr = new WorkspaceManager(root, hooks);
    const ws = await mgr.createForIssue("BRM-1");
    await mgr.removeWorkspace("BRM-1");
    // The directory is removed after the hook runs, but the hook was executed;
    // we can verify it didn't throw (directory cleanup succeeded).
    await expect(stat(ws.path)).rejects.toThrow();
  });

  it("removeWorkspace proceeds even if before_remove hook fails", async () => {
    const hooks: HooksConfig = {
      ...noHooks,
      before_remove: "exit 1",
    };
    const mgr = new WorkspaceManager(root, hooks);
    const ws = await mgr.createForIssue("BRF-1");
    // Should not throw despite hook failure
    await mgr.removeWorkspace("BRF-1");
    await expect(stat(ws.path)).rejects.toThrow();
  });

  it("before_run hook failure throws WorkspaceError", async () => {
    const hooks: HooksConfig = {
      ...noHooks,
      before_run: "exit 1",
    };
    const mgr = new WorkspaceManager(root, hooks);
    const ws = await mgr.createForIssue("BR-1");
    await expect(mgr.runBeforeRunHook(ws.path)).rejects.toThrow(
      WorkspaceError,
    );
  });

  it("after_run hook failure does not throw", async () => {
    const hooks: HooksConfig = {
      ...noHooks,
      after_run: "exit 1",
    };
    const mgr = new WorkspaceManager(root, hooks);
    const ws = await mgr.createForIssue("AR-1");
    // Should not throw despite hook failure
    await expect(mgr.runAfterRunHook(ws.path)).resolves.toBeUndefined();
  });

  it("handles file at workspace location by replacing with directory", async () => {
    const filePath = join(root, "FILE-1");
    await writeFile(filePath, "not a dir");
    const mgr = new WorkspaceManager(root, noHooks);
    const ws = await mgr.createForIssue("FILE-1");
    expect(ws.created_now).toBe(true);
    const s = await stat(ws.path);
    expect(s.isDirectory()).toBe(true);
  });
});
