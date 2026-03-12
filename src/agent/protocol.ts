// ---------------------------------------------------------------------------
// Codex App-Server Protocol Types — Section 10
// JSON-RPC-like message types for the app-server protocol over stdio.
// ---------------------------------------------------------------------------

/**
 * A JSON-RPC-like request or notification sent to the app-server.
 */
export interface ProtocolRequest {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * A JSON-RPC-like response from the app-server.
 */
export interface ProtocolResponse {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
  params?: Record<string, unknown>;
}

/**
 * Structured event emitted upstream to the orchestrator.
 */
export interface CodexEvent {
  event: CodexEventType;
  timestamp: Date;
  codex_app_server_pid?: string;
  usage?: TokenUsage;
  payload?: Record<string, unknown>;
  message?: string;
}

export type CodexEventType =
  | "session_started"
  | "startup_failed"
  | "turn_completed"
  | "turn_failed"
  | "turn_cancelled"
  | "turn_ended_with_error"
  | "turn_input_required"
  | "approval_auto_approved"
  | "unsupported_tool_call"
  | "notification"
  | "token_usage_updated"
  | "other_message"
  | "malformed";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface RateLimit {
  model?: string;
  remaining_tokens?: number;
  remaining_requests?: number;
  reset_tokens?: string;
  reset_requests?: string;
}
