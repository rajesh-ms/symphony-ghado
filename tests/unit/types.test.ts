import { describe, it, expect } from "vitest";
import {
  sanitizeWorkspaceKey,
  normalizeState,
  buildSessionId,
} from "../../src/types.js";

describe("sanitizeWorkspaceKey", () => {
  it("keeps alphanumeric, dot, dash, underscore", () => {
    expect(sanitizeWorkspaceKey("ABC-123")).toBe("ABC-123");
    expect(sanitizeWorkspaceKey("my.key_v2")).toBe("my.key_v2");
  });

  it("replaces spaces and special chars with underscore", () => {
    expect(sanitizeWorkspaceKey("ABC 123")).toBe("ABC_123");
    expect(sanitizeWorkspaceKey("issue/branch#1")).toBe("issue_branch_1");
  });

  it("replaces all non-allowed characters", () => {
    expect(sanitizeWorkspaceKey("a@b$c%d^e&f")).toBe("a_b_c_d_e_f");
  });

  it("handles empty string", () => {
    expect(sanitizeWorkspaceKey("")).toBe("");
  });
});

describe("normalizeState", () => {
  it("trims and lowercases", () => {
    expect(normalizeState("  Active  ")).toBe("active");
    expect(normalizeState("NEW")).toBe("new");
    expect(normalizeState("In Progress")).toBe("in progress");
  });

  it("handles already normalized state", () => {
    expect(normalizeState("done")).toBe("done");
  });
});

describe("buildSessionId", () => {
  it("composes thread and turn IDs", () => {
    expect(buildSessionId("thread-abc", "turn-1")).toBe("thread-abc-turn-1");
  });

  it("works with arbitrary strings", () => {
    expect(buildSessionId("t1", "t2")).toBe("t1-t2");
  });
});
