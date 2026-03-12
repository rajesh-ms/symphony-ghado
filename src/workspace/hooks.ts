// ---------------------------------------------------------------------------
// Workspace Hooks — Section 9.4
// Shell hook execution with timeout.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";

export interface HookResult {
  ok: boolean;
  error?: string;
}

/**
 * Run a shell hook script in the given working directory with a timeout.
 */
export async function runHook(
  name: string,
  script: string,
  cwd: string,
  timeoutMs: number,
): Promise<HookResult> {
  return new Promise<HookResult>((res) => {
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "bash";
    const args = isWindows ? ["/c", script] : ["-lc", script];

    const child = spawn(shell, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      // Truncate to avoid unbounded log
      if (stdout.length > 10000) stdout = stdout.slice(0, 10000);
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 10000) stderr = stderr.slice(0, 10000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000);
      res({
        ok: false,
        error: `Hook '${name}' timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      res({ ok: false, error: `Hook '${name}' spawn error: ${err.message}` });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        res({ ok: true });
      } else {
        res({
          ok: false,
          error: `Hook '${name}' exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
        });
      }
    });
  });
}
