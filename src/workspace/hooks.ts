// ---------------------------------------------------------------------------
// Workspace Hooks — Section 9.4
// Shell hook execution with timeout.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";

/**
 * Convert a Windows path (C:\foo\bar) to a WSL path (/mnt/c/foo/bar).
 */
function windowsToWslPath(winPath: string): string {
  const match = winPath.match(/^([A-Za-z]):[/\\](.*)/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, "/");
    return `/mnt/${drive}/${rest}`;
  }
  return winPath.replace(/\\/g, "/");
}

/**
 * Build shell export statements for env vars that need forwarding to WSL.
 */
function buildEnvExports(varNames: string[]): string {
  const exports: string[] = [];
  for (const name of varNames) {
    const val = process.env[name];
    if (val) {
      // Escape single quotes in the value
      const escaped = val.replace(/'/g, "'\\''");
      exports.push(`export ${name}='${escaped}'`);
    }
  }
  return exports.length > 0 ? exports.join(" && ") + " && " : "";
}

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

    let child;
    if (isWindows) {
      // On Windows, run hooks through WSL bash so bash syntax works.
      // Convert the Windows cwd to a WSL /mnt/ path.
      const wslCwd = windowsToWslPath(cwd);
      // Forward key env vars that WSL won't inherit from Windows
      const envExports = buildEnvExports(["ADO_PAT", "OPENAI_API_KEY", "GITHUB_TOKEN"]);
      const wrappedScript = `${envExports}cd "${wslCwd}" && ${script}`;
      child = spawn("wsl", ["--", "bash", "-c", wrappedScript], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } else {
      child = spawn("bash", ["-lc", script], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    }

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
