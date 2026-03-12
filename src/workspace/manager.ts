// ---------------------------------------------------------------------------
// Workspace Manager — Section 9
// Create, reuse, and clean per-issue workspaces.
// ---------------------------------------------------------------------------

import { mkdir, rm, stat } from "node:fs/promises";
import type { Workspace, HooksConfig } from "../types.js";
import {
  resolveWorkspacePath,
  validateWorkspaceContainment,
  sanitizeWorkspaceKey,
} from "./safety.js";
import { runHook } from "./hooks.js";

export class WorkspaceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export class WorkspaceManager {
  constructor(
    private readonly root: string,
    private readonly hooks: HooksConfig,
  ) {}

  /**
   * Create or reuse a workspace for the given issue identifier.
   * Returns workspace metadata including whether it was newly created.
   */
  async createForIssue(identifier: string): Promise<Workspace> {
    const key = sanitizeWorkspaceKey(identifier);
    const wsPath = resolveWorkspacePath(this.root, identifier);

    // Safety: validate containment before any filesystem operations
    validateWorkspaceContainment(this.root, wsPath);

    let created_now = false;
    try {
      const s = await stat(wsPath);
      if (!s.isDirectory()) {
        // Exists but not a directory — remove and recreate
        await rm(wsPath, { force: true });
        await mkdir(wsPath, { recursive: true });
        created_now = true;
      }
      // else: already a directory, reuse
    } catch {
      // Does not exist — create
      await mkdir(wsPath, { recursive: true });
      created_now = true;
    }

    // Run after_create hook if newly created and hook is configured
    if (created_now && this.hooks.after_create) {
      const result = await runHook(
        "after_create",
        this.hooks.after_create,
        wsPath,
        this.hooks.timeout_ms,
      );
      if (!result.ok) {
        // Fatal: remove partially prepared directory
        await rm(wsPath, { recursive: true, force: true }).catch(() => {});
        throw new WorkspaceError(
          "after_create_hook_failed",
          result.error ?? "after_create hook failed",
        );
      }
    }

    return { path: wsPath, workspace_key: key, created_now };
  }

  /**
   * Run the before_run hook if configured. Failure aborts the current attempt.
   */
  async runBeforeRunHook(wsPath: string): Promise<void> {
    if (!this.hooks.before_run) return;
    const result = await runHook(
      "before_run",
      this.hooks.before_run,
      wsPath,
      this.hooks.timeout_ms,
    );
    if (!result.ok) {
      throw new WorkspaceError(
        "before_run_hook_failed",
        result.error ?? "before_run hook failed",
      );
    }
  }

  /**
   * Run the after_run hook if configured. Failures are logged and ignored.
   */
  async runAfterRunHook(wsPath: string): Promise<void> {
    if (!this.hooks.after_run) return;
    const result = await runHook(
      "after_run",
      this.hooks.after_run,
      wsPath,
      this.hooks.timeout_ms,
    );
    if (!result.ok) {
      // Log but ignore
      console.warn(`after_run hook failed: ${result.error}`);
    }
  }

  /**
   * Remove the workspace for the given issue identifier.
   * Runs before_remove hook (best-effort) then deletes the directory.
   */
  async removeWorkspace(identifier: string): Promise<void> {
    const wsPath = resolveWorkspacePath(this.root, identifier);
    validateWorkspaceContainment(this.root, wsPath);

    // Run before_remove hook (best-effort)
    if (this.hooks.before_remove) {
      try {
        const exists = await stat(wsPath)
          .then((s) => s.isDirectory())
          .catch(() => false);

        if (exists) {
          await runHook(
            "before_remove",
            this.hooks.before_remove,
            wsPath,
            this.hooks.timeout_ms,
          );
        }
      } catch {
        // Ignore — best-effort
      }
    }

    await rm(wsPath, { recursive: true, force: true });
  }
}
