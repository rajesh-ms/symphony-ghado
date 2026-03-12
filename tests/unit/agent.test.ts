import { describe, it, expect } from "vitest";
import {
  classifyMessage,
  extractUsage,
  extractRateLimits,
} from "../../src/agent/events.js";
import type { ProtocolResponse } from "../../src/agent/protocol.js";

describe("agent / events — classifyMessage", () => {
  it("classifies turn/completed", () => {
    const msg: ProtocolResponse = { method: "turn/completed", params: {} };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("turn_completed");
  });

  it("classifies turn/failed", () => {
    const msg: ProtocolResponse = {
      method: "turn/failed",
      params: { error: "something broke" },
    };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("turn_failed");
    expect(evt.message).toBe("something broke");
  });

  it("classifies turn/cancelled", () => {
    const msg: ProtocolResponse = { method: "turn/cancelled" };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("turn_cancelled");
  });

  it("classifies user input required", () => {
    const msg: ProtocolResponse = {
      method: "item/tool/requestUserInput",
      params: {},
    };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("turn_input_required");
  });

  it("classifies user input required via flag", () => {
    const msg: ProtocolResponse = {
      method: "turn/update",
      params: { inputRequired: true },
    };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("turn_input_required");
  });

  it("classifies approval request", () => {
    const msg: ProtocolResponse = {
      method: "item/approval/request",
      params: { id: 5 },
    };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("approval_auto_approved");
  });

  it("classifies unsupported tool call", () => {
    const msg: ProtocolResponse = {
      method: "item/tool/call",
      params: { name: "some_tool" },
    };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("unsupported_tool_call");
    expect(evt.message).toBe("some_tool");
  });

  it("classifies token usage update", () => {
    const msg: ProtocolResponse = {
      method: "thread/tokenUsage/updated",
      params: {
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      },
    };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("token_usage_updated");
    expect(evt.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    });
  });

  it("classifies generic notification", () => {
    const msg: ProtocolResponse = {
      method: "status/update",
      params: { message: "Working on tests" },
    };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("notification");
    expect(evt.message).toBe("Working on tests");
  });

  it("classifies response without method as other_message", () => {
    const msg: ProtocolResponse = { id: 1, result: { ok: true } };
    const evt = classifyMessage(msg);
    expect(evt.event).toBe("other_message");
  });

  it("includes PID when provided", () => {
    const msg: ProtocolResponse = { method: "turn/completed" };
    const evt = classifyMessage(msg, "12345");
    expect(evt.codex_app_server_pid).toBe("12345");
  });
});

describe("agent / events — extractUsage", () => {
  it("extracts from params.usage", () => {
    const msg: ProtocolResponse = {
      method: "thread/tokenUsage/updated",
      params: {
        usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
      },
    };
    expect(extractUsage(msg)).toEqual({
      input_tokens: 200,
      output_tokens: 100,
      total_tokens: 300,
    });
  });

  it("extracts from total_token_usage", () => {
    const msg: ProtocolResponse = {
      params: {
        total_token_usage: {
          input_tokens: 500,
          output_tokens: 250,
          total_tokens: 750,
        },
      },
    };
    expect(extractUsage(msg)).toEqual({
      input_tokens: 500,
      output_tokens: 250,
      total_tokens: 750,
    });
  });

  it("extracts inline token fields", () => {
    const msg: ProtocolResponse = {
      params: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
    expect(extractUsage(msg)).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    });
  });

  it("handles camelCase token fields", () => {
    const msg: ProtocolResponse = {
      params: {
        usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
      },
    };
    expect(extractUsage(msg)).toEqual({
      input_tokens: 30,
      output_tokens: 20,
      total_tokens: 50,
    });
  });

  it("returns undefined when no usage present", () => {
    const msg: ProtocolResponse = { params: {} };
    expect(extractUsage(msg)).toBeUndefined();
  });
});

describe("agent / events — extractRateLimits", () => {
  it("extracts rate_limits from params", () => {
    const msg: ProtocolResponse = {
      params: {
        rate_limits: {
          model: "gpt-4",
          remaining_tokens: 1000,
          remaining_requests: 5,
        },
      },
    };
    const rl = extractRateLimits(msg);
    expect(rl).toEqual({
      model: "gpt-4",
      remaining_tokens: 1000,
      remaining_requests: 5,
      reset_tokens: undefined,
      reset_requests: undefined,
    });
  });

  it("extracts camelCase rateLimits", () => {
    const msg: ProtocolResponse = {
      params: { rateLimits: { model: "gpt-4" } },
    };
    expect(extractRateLimits(msg)?.model).toBe("gpt-4");
  });

  it("returns undefined when no rate limits", () => {
    const msg: ProtocolResponse = { params: {} };
    expect(extractRateLimits(msg)).toBeUndefined();
  });
});
