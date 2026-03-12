// ---------------------------------------------------------------------------
// Core Domain Model — Section 4 of the Symphony prodspec
// ---------------------------------------------------------------------------

// ---- 4.1.1 Issue ----

export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  labels: string[];
  blocked_by: BlockerRef[];
  created_at: string | null; // ISO-8601
  updated_at: string | null; // ISO-8601
}

// ---- 4.1.2 Workflow Definition ----

export interface WorkflowDefinition {
  config: Record<string, unknown>;
  prompt_template: string;
}

// ---- 4.1.3 Service Config (Typed View) ----

export interface TrackerConfig {
  kind: string;
  endpoint: string;
  api_key: string;
  project_slug: string;
  active_states: string[];
  terminal_states: string[];
}

export interface PollingConfig {
  interval_ms: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HooksConfig {
  after_create: string | null;
  before_run: string | null;
  after_run: string | null;
  before_remove: string | null;
  timeout_ms: number;
}

export interface AgentConfig {
  max_concurrent_agents: number;
  max_turns: number;
  max_retry_backoff_ms: number;
  max_concurrent_agents_by_state: Map<string, number>;
}

export interface CodexConfig {
  command: string;
  approval_policy: string;
  thread_sandbox: string;
  turn_sandbox_policy: string;
  turn_timeout_ms: number;
  read_timeout_ms: number;
  stall_timeout_ms: number;
}

export interface ServerConfig {
  port: number | null;
}

// ---- MCP Server Config ----

interface McpServerBase {
  enabled: boolean;
  required: boolean;
  startup_timeout_sec: number | null;
  tool_timeout_sec: number | null;
}

export interface McpHttpServerConfig extends McpServerBase {
  transport: "http";
  url: string;
  bearer_token_env_var: string | null;
  headers: Record<string, string>;
  env_headers: Record<string, string>;
}

export interface McpStdioServerConfig extends McpServerBase {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
}

export type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig;

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface ServiceConfig {
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  codex: CodexConfig;
  mcp: McpConfig;
  server: ServerConfig;
  prompt_template: string;
}

// ---- 4.1.4 Workspace ----

export interface Workspace {
  path: string;
  workspace_key: string;
  created_now: boolean;
}

// ---- 4.1.5 Run Attempt ----

export enum RunAttemptStatus {
  PreparingWorkspace = "PreparingWorkspace",
  BuildingPrompt = "BuildingPrompt",
  LaunchingAgentProcess = "LaunchingAgentProcess",
  InitializingSession = "InitializingSession",
  StreamingTurn = "StreamingTurn",
  Finishing = "Finishing",
  Succeeded = "Succeeded",
  Failed = "Failed",
  TimedOut = "TimedOut",
  Stalled = "Stalled",
  CanceledByReconciliation = "CanceledByReconciliation",
}

export interface RunAttempt {
  issue_id: string;
  issue_identifier: string;
  attempt: number | null;
  workspace_path: string;
  started_at: string; // ISO-8601
  status: RunAttemptStatus;
  error?: string;
}

// ---- 4.1.6 Live Session ----

export interface LiveSession {
  session_id: string;
  thread_id: string;
  turn_id: string;
  codex_app_server_pid: string | null;
  last_codex_event: string | null;
  last_codex_timestamp: string | null;
  last_codex_message: string | null;
  codex_input_tokens: number;
  codex_output_tokens: number;
  codex_total_tokens: number;
  last_reported_input_tokens: number;
  last_reported_output_tokens: number;
  last_reported_total_tokens: number;
  turn_count: number;
}

// ---- 4.1.7 Retry Entry ----

export interface RetryEntry {
  issue_id: string;
  identifier: string;
  attempt: number;
  due_at_ms: number;
  timer_handle: ReturnType<typeof setTimeout>;
  error: string | null;
}

// ---- 4.1.8 Orchestrator Runtime State ----

export interface CodexTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  seconds_running: number;
}

export interface RunningEntry {
  identifier: string;
  issue: Issue;
  session_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  codex_app_server_pid: string | null;
  last_codex_message: string | null;
  last_codex_event: string | null;
  last_codex_timestamp: Date | null;
  codex_input_tokens: number;
  codex_output_tokens: number;
  codex_total_tokens: number;
  last_reported_input_tokens: number;
  last_reported_output_tokens: number;
  last_reported_total_tokens: number;
  retry_attempt: number | null;
  started_at: Date;
  turn_count: number;
}

export interface OrchestratorState {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
  codex_totals: CodexTotals;
  codex_rate_limits: Record<string, unknown> | null;
}

// ---- 4.2 Normalization Helpers ----

/**
 * Sanitize an issue identifier for use as a workspace directory name.
 * Only [A-Za-z0-9._-] are kept; everything else becomes '_'.
 */
export function sanitizeWorkspaceKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Normalize an issue state for comparison: trim + lowercase.
 */
export function normalizeState(state: string): string {
  return state.trim().toLowerCase();
}

/**
 * Build a session ID from thread and turn IDs.
 */
export function buildSessionId(threadId: string, turnId: string): string {
  return `${threadId}-${turnId}`;
}

// ---- Codex Update Event (Section 10.4) ----

export interface CodexUpdateEvent {
  issue_id: string;
  event: string;
  timestamp: Date;
  codex_app_server_pid?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  message?: string;
  payload?: Record<string, unknown>;
}

// ---- Validation Result ----

export interface ValidationError {
  code: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };
