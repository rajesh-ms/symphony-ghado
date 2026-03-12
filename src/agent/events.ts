// ---------------------------------------------------------------------------
// Codex Event Extraction — Section 10.4, 13.5
// Normalize raw app-server messages into structured CodexEvents.
// ---------------------------------------------------------------------------

import type {
  ProtocolResponse,
  CodexEvent,
  CodexEventType,
  TokenUsage,
  RateLimit,
} from "./protocol.js";

/**
 * Extract a structured event from a raw protocol message.
 */
export function classifyMessage(
  msg: ProtocolResponse,
  pid?: string,
): CodexEvent {
  const ts = new Date();
  const base = { timestamp: ts, codex_app_server_pid: pid };

  const method = msg.method ?? "";

  // Turn completion events
  if (method === "turn/completed") {
    return {
      ...base,
      event: "turn_completed",
      usage: extractUsage(msg),
      message: "Turn completed",
    };
  }

  if (method === "turn/failed") {
    return {
      ...base,
      event: "turn_failed",
      message: extractErrorMessage(msg),
      usage: extractUsage(msg),
    };
  }

  if (method === "turn/cancelled") {
    return {
      ...base,
      event: "turn_cancelled",
      message: "Turn cancelled",
    };
  }

  // User input required (hard failure per spec 10.5)
  if (
    method === "item/tool/requestUserInput" ||
    isInputRequired(msg)
  ) {
    return {
      ...base,
      event: "turn_input_required",
      message: "Agent requested user input",
    };
  }

  // Approval requests
  if (isApprovalRequest(msg)) {
    return {
      ...base,
      event: "approval_auto_approved",
      payload: msg.params as Record<string, unknown>,
      message: "Auto-approved",
    };
  }

  // Tool calls
  if (method === "item/tool/call") {
    return {
      ...base,
      event: "unsupported_tool_call",
      payload: msg.params as Record<string, unknown>,
      message: extractToolName(msg),
    };
  }

  // Token usage updates
  if (method === "thread/tokenUsage/updated") {
    return {
      ...base,
      event: "token_usage_updated",
      usage: extractUsage(msg),
      message: "Token usage updated",
    };
  }

  // General notifications
  if (msg.method && !msg.id) {
    // Try to extract usage from any notification (codex may send it under various methods)
    const usage = extractUsage(msg);
    // If this notification carries token usage, classify it as a token event
    if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0 || usage.total_tokens > 0)) {
      return {
        ...base,
        event: "token_usage_updated",
        usage,
        message: "Token usage updated",
      };
    }
    return {
      ...base,
      event: "notification",
      payload: msg.params as Record<string, unknown>,
      message: summarizeNotification(msg),
      usage,
    };
  }

  return {
    ...base,
    event: "other_message",
    payload: msg as unknown as Record<string, unknown>,
    message: method || "response",
  };
}

/**
 * Detect approval request messages (command/file-change approvals).
 */
function isApprovalRequest(msg: ProtocolResponse): boolean {
  const m = msg.method ?? "";
  return (
    m === "item/approval/request" ||
    m === "item/command/approval/request" ||
    m.includes("approval")
  );
}

/**
 * Detect user-input-required signals from various payload shapes.
 */
function isInputRequired(msg: ProtocolResponse): boolean {
  const params = msg.params as Record<string, unknown> | undefined;
  if (!params) return false;
  // Check turn flags or explicit method
  if (params.inputRequired === true || params.userInputRequired === true) {
    return true;
  }
  return false;
}

/**
 * Extract token usage from various nested payload shapes.
 * Prefer absolute thread totals when available.
 */
export function extractUsage(msg: ProtocolResponse): TokenUsage | undefined {
  const params = (msg.params ?? msg.result ?? {}) as Record<string, unknown>;

  // Shape 1: thread/tokenUsage/updated → params.tokenUsage.total (camelCase)
  const tokenUsage = params.tokenUsage as Record<string, unknown> | undefined;
  if (tokenUsage) {
    const total = tokenUsage.total as Record<string, unknown> | undefined;
    if (total) {
      return parseTokenFields(total);
    }
    return parseTokenFields(tokenUsage);
  }

  // Shape 2: params.usage (snake_case)
  const usage = params.usage as Record<string, unknown> | undefined;
  if (usage) {
    return parseTokenFields(usage);
  }

  // Shape 3: codex/event/token_count → params.msg.info.total_token_usage
  const msgPayload = params.msg as Record<string, unknown> | undefined;
  if (msgPayload?.info) {
    const info = msgPayload.info as Record<string, unknown>;
    const totalUsage = info.total_token_usage as Record<string, unknown> | undefined;
    if (totalUsage) {
      return parseTokenFields(totalUsage);
    }
  }

  // Shape 4: total_token_usage wrapper
  const totalUsage = params.total_token_usage as Record<string, unknown> | undefined;
  if (totalUsage) {
    return parseTokenFields(totalUsage);
  }

  // Shape 5: Inline token fields
  if (
    "input_tokens" in params ||
    "output_tokens" in params ||
    "total_tokens" in params ||
    "inputTokens" in params ||
    "outputTokens" in params ||
    "totalTokens" in params
  ) {
    return parseTokenFields(params);
  }

  return undefined;
}

function parseTokenFields(obj: Record<string, unknown>): TokenUsage {
  return {
    input_tokens: toInt(obj.input_tokens ?? obj.inputTokens ?? 0),
    output_tokens: toInt(obj.output_tokens ?? obj.outputTokens ?? 0),
    total_tokens: toInt(obj.total_tokens ?? obj.totalTokens ?? 0),
  };
}

/**
 * Extract rate-limit info from agent events if present.
 */
export function extractRateLimits(
  msg: ProtocolResponse,
): RateLimit | undefined {
  const params = (msg.params ?? msg.result ?? {}) as Record<string, unknown>;
  const rl = (params.rate_limits ??
    params.rateLimits ??
    params.rate_limit) as Record<string, unknown> | undefined;
  if (!rl) return undefined;
  return {
    model: rl.model as string | undefined,
    remaining_tokens: rl.remaining_tokens as number | undefined,
    remaining_requests: rl.remaining_requests as number | undefined,
    reset_tokens: rl.reset_tokens as string | undefined,
    reset_requests: rl.reset_requests as string | undefined,
  };
}

function extractErrorMessage(msg: ProtocolResponse): string {
  if (msg.error?.message) return msg.error.message;
  const params = msg.params as Record<string, unknown> | undefined;
  if (params?.error) return String(params.error);
  if (params?.message) return String(params.message);
  return "unknown error";
}

function extractToolName(msg: ProtocolResponse): string {
  const params = msg.params as Record<string, unknown> | undefined;
  return (params?.name ?? params?.toolName ?? "unknown_tool") as string;
}

function summarizeNotification(msg: ProtocolResponse): string {
  const params = msg.params as Record<string, unknown> | undefined;
  if (params?.message) return String(params.message);
  if (params?.text) return String(params.text);
  return msg.method ?? "notification";
}

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}
