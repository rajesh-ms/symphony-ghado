// ---------------------------------------------------------------------------
// Config Layer — Section 6 of the Symphony prodspec
// Resolves raw YAML config into typed ServiceConfig with defaults and env vars.
// ---------------------------------------------------------------------------

import { tmpdir, homedir } from "node:os";
import { resolve, sep } from "node:path";
import type {
  McpHttpServerConfig,
  McpServerConfig,
  McpStdioServerConfig,
  ServiceConfig,
} from "../types.js";

/**
 * Resolve `$VAR_NAME` tokens in a string using environment variables.
 * Returns the resolved string, or the original if no token is present.
 */
export function resolveEnvVar(value: string): string {
  if (value.startsWith("$")) {
    const varName = value.slice(1);
    return process.env[varName] ?? "";
  }
  return value;
}

/**
 * Expand ~ to home directory and resolve path-like values.
 */
export function expandPath(value: string): string {
  let resolved = resolveEnvVar(value);
  if (resolved.startsWith("~")) {
    resolved = resolve(homedir(), resolved.slice(1).replace(/^[/\\]/, ""));
  } else if (resolved.includes(sep) || resolved.includes("/")) {
    resolved = resolve(resolved);
  }
  return resolved;
}

/**
 * Coerce a value to an integer, returning the default if it can't be parsed.
 */
function toInt(value: unknown, defaultValue: number): number {
  if (value == null) return defaultValue;
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

/**
 * Parse active_states / terminal_states from list or comma-separated string.
 */
function toStringList(value: unknown, defaults: string[]): string[] {
  if (value == null) return defaults;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return defaults;
}

function asString(value: unknown, defaultValue: string): string {
  if (value == null) return defaultValue;
  return String(value);
}

function asOptionalString(value: unknown): string | null {
  if (value == null) return null;
  const stringValue = String(value).trim();
  return stringValue ? stringValue : null;
}

function asRecord(parent: unknown): Record<string, unknown> {
  if (parent != null && typeof parent === "object" && !Array.isArray(parent)) {
    return parent as Record<string, unknown>;
  }
  return {};
}

function toBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return defaultValue;
}

function toNullablePositiveInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "string" ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function toStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveStringRecord(
  value: unknown,
  options: { resolveEnv?: boolean } = {},
): Record<string, string> {
  const record = asRecord(value);
  const resolved: Record<string, string> = {};

  for (const [key, entry] of Object.entries(record)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    const stringValue = String(entry);
    resolved[normalizedKey] = options.resolveEnv
      ? resolveEnvVar(stringValue)
      : stringValue;
  }

  return resolved;
}

function resolveMcpServer(server: unknown): McpServerConfig | null {
  const raw = asRecord(server);
  const transport = asString(raw.transport, "").trim().toLowerCase();
  const enabled = toBoolean(raw.enabled, true);
  const required = toBoolean(raw.required, false);
  const startup_timeout_sec = toNullablePositiveInt(raw.startup_timeout_sec);
  const tool_timeout_sec = toNullablePositiveInt(raw.tool_timeout_sec);

  if (transport === "http") {
    const url = asOptionalString(raw.url);
    if (!url) return null;

    const httpServer: McpHttpServerConfig = {
      transport: "http",
      url,
      bearer_token_env_var: asOptionalString(raw.bearer_token_env_var),
      headers: resolveStringRecord(raw.headers, { resolveEnv: true }),
      env_headers: resolveStringRecord(raw.env_headers),
      enabled,
      required,
      startup_timeout_sec,
      tool_timeout_sec,
    };

    return httpServer;
  }

  const command = asOptionalString(raw.command);
  if (!command) return null;

  const stdioServer: McpStdioServerConfig = {
    transport: "stdio",
    command,
    args: toStringArray(raw.args),
    env: resolveStringRecord(raw.env, { resolveEnv: true }),
    cwd: asOptionalString(raw.cwd),
    enabled,
    required,
    startup_timeout_sec,
    tool_timeout_sec,
  };

  return stdioServer;
}

function resolveMcpServers(value: unknown): Record<string, McpServerConfig> {
  const rawServers = asRecord(value);
  const servers: Record<string, McpServerConfig> = {};

  for (const [name, server] of Object.entries(rawServers)) {
    const normalizedName = name.trim();
    if (!normalizedName) continue;
    const resolvedServer = resolveMcpServer(server);
    if (resolvedServer) {
      servers[normalizedName] = resolvedServer;
    }
  }

  return servers;
}

/**
 * Resolve raw YAML front matter config into a fully typed ServiceConfig.
 */
export function resolveConfig(
  rawConfig: Record<string, unknown>,
): ServiceConfig {
  const tracker = asRecord(rawConfig.tracker);
  const polling = asRecord(rawConfig.polling);
  const workspace = asRecord(rawConfig.workspace);
  const hooks = asRecord(rawConfig.hooks);
  const agent = asRecord(rawConfig.agent);
  const codex = asRecord(rawConfig.codex);
  const mcp = asRecord(rawConfig.mcp);
  const server = asRecord(rawConfig.server);

  // Resolve tracker API key via env var
  const rawApiKey = asString(tracker.api_key, "");
  const resolvedApiKey = resolveEnvVar(rawApiKey);

  // Resolve workspace root
  const rawRoot = asString(workspace.root, "");
  const defaultRoot = resolve(tmpdir(), "symphony_workspaces");
  const workspaceRoot = rawRoot ? expandPath(rawRoot) : defaultRoot;

  // Parse per-state concurrency map
  const rawByState = asRecord(agent.max_concurrent_agents_by_state);
  const byState = new Map<string, number>();
  for (const [key, val] of Object.entries(rawByState)) {
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) {
      byState.set(key.trim().toLowerCase(), n);
    }
  }

  // Hook timeout: non-positive falls back to default
  const rawHookTimeout = toInt(hooks.timeout_ms, 60000);
  const hookTimeout = rawHookTimeout > 0 ? rawHookTimeout : 60000;

  return {
    tracker: {
      kind: asString(tracker.kind, ""),
      endpoint: asString(tracker.endpoint, ""),
      api_key: resolvedApiKey,
      project_slug: asString(tracker.project_slug, ""),
      active_states: toStringList(tracker.active_states, ["New", "Active"]),
      terminal_states: toStringList(tracker.terminal_states, [
        "Closed",
        "Resolved",
        "Done",
        "Cancelled",
      ]),
    },
    polling: {
      interval_ms: toInt(polling.interval_ms, 30000),
    },
    workspace: {
      root: workspaceRoot,
    },
    hooks: {
      after_create: hooks.after_create != null ? String(hooks.after_create) : null,
      before_run: hooks.before_run != null ? String(hooks.before_run) : null,
      after_run: hooks.after_run != null ? String(hooks.after_run) : null,
      before_remove: hooks.before_remove != null ? String(hooks.before_remove) : null,
      timeout_ms: hookTimeout,
    },
    agent: {
      max_concurrent_agents: toInt(agent.max_concurrent_agents, 10),
      // agent.max_turns — spec Section 6.4 cheat-sheet, default 20.
      // Not in Section 5.3.5 front-matter schema but referenced in Section 16.5 worker algorithm.
      max_turns: toInt(agent.max_turns, 20),
      max_retry_backoff_ms: toInt(agent.max_retry_backoff_ms, 300000),
      max_concurrent_agents_by_state: byState,
    },
    codex: {
      command: asString(codex.command, "codex app-server"),
      approval_policy: asString(codex.approval_policy, "never"),
      thread_sandbox: asString(codex.thread_sandbox, "danger-full-access"),
      turn_sandbox_policy: asString(codex.turn_sandbox_policy, "dangerFullAccess"),
      turn_timeout_ms: toInt(codex.turn_timeout_ms, 3600000),
      read_timeout_ms: toInt(codex.read_timeout_ms, 5000),
      stall_timeout_ms: toInt(codex.stall_timeout_ms, 300000),
    },
    mcp: {
      servers: resolveMcpServers(mcp.servers),
    },
    server: {
      port: server.port != null ? toInt(server.port, 0) : null,
    },
    prompt_template: "",
  };
}
