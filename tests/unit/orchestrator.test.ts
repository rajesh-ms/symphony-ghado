import { describe, it, expect } from "vitest";
import type { Issue, ServiceConfig, OrchestratorState } from "../../src/types.js";
import {
  createInitialState,
  isDispatchEligible,
  sortForDispatch,
  availableSlots,
  calculateBackoff,
  nextAttempt,
} from "../../src/orchestrator/state.js";

function makeConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    tracker: {
      kind: "ado",
      endpoint: "https://dev.azure.com/org",
      api_key: "token",
      project_slug: "proj",
      active_states: ["New", "Active"],
      terminal_states: ["Closed", "Resolved", "Done", "Cancelled"],
    },
    polling: { interval_ms: 30000 },
    workspace: { root: "/tmp/ws" },
    hooks: {
      after_create: null,
      before_run: null,
      after_run: null,
      before_remove: null,
      timeout_ms: 60000,
    },
    agent: {
      max_concurrent_agents: 10,
      max_turns: 20,
      max_retry_backoff_ms: 300000,
      max_concurrent_agents_by_state: new Map<string, number>(),
    },
    codex: {
      command: "codex app-server",
      approval_policy: "auto-edit",
      thread_sandbox: "none",
      turn_sandbox_policy: "none",
      turn_timeout_ms: 3600000,
      read_timeout_ms: 5000,
      stall_timeout_ms: 300000,
    },
    server: { port: null },
    prompt_template: "Work on {{ issue.title }}",
    ...overrides,
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "1",
    identifier: "MT-1",
    title: "Test issue",
    description: null,
    priority: 2,
    state: "Active",
    branch_name: null,
    url: null,
    labels: [],
    blocked_by: [],
    created_at: new Date("2025-01-01"),
    updated_at: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<OrchestratorState> = {}): OrchestratorState {
  return {
    poll_interval_ms: 30000,
    max_concurrent_agents: 10,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    codex_rate_limits: null,
    ...overrides,
  };
}

describe("orchestrator / state — createInitialState", () => {
  it("creates state with config values", () => {
    const config = makeConfig();
    const state = createInitialState(config);
    expect(state.poll_interval_ms).toBe(30000);
    expect(state.max_concurrent_agents).toBe(10);
    expect(state.running.size).toBe(0);
    expect(state.claimed.size).toBe(0);
  });
});

describe("orchestrator / state — isDispatchEligible", () => {
  it("eligible issue passes", () => {
    const issue = makeIssue();
    const state = makeState();
    const config = makeConfig();
    expect(isDispatchEligible(issue, state, config)).toBe(true);
  });

  it("missing id makes ineligible", () => {
    const issue = makeIssue({ id: "" });
    expect(isDispatchEligible(issue, makeState(), makeConfig())).toBe(false);
  });

  it("terminal state is ineligible", () => {
    const issue = makeIssue({ state: "Closed" });
    expect(isDispatchEligible(issue, makeState(), makeConfig())).toBe(false);
  });

  it("non-active state is ineligible", () => {
    const issue = makeIssue({ state: "Human Review" });
    expect(isDispatchEligible(issue, makeState(), makeConfig())).toBe(false);
  });

  it("already running is ineligible", () => {
    const state = makeState();
    state.running.set("1", {} as any);
    const issue = makeIssue({ id: "1" });
    expect(isDispatchEligible(issue, state, makeConfig())).toBe(false);
  });

  it("already claimed is ineligible", () => {
    const state = makeState();
    state.claimed.add("1");
    const issue = makeIssue({ id: "1" });
    expect(isDispatchEligible(issue, state, makeConfig())).toBe(false);
  });

  it("global concurrency limit blocks dispatch", () => {
    const state = makeState({ max_concurrent_agents: 1 });
    state.running.set("other", {} as any);
    const issue = makeIssue({ id: "2" });
    expect(isDispatchEligible(issue, state, makeConfig())).toBe(false);
  });

  it("per-state concurrency limit blocks dispatch", () => {
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 10,
        max_turns: 20,
        max_retry_backoff_ms: 300000,
        max_concurrent_agents_by_state: new Map([["active", 1]]),
      },
    });
    const state = makeState();
    state.running.set("other", {
      issue: makeIssue({ id: "other", state: "Active" }),
    } as any);
    const issue = makeIssue({ id: "2", state: "Active" });
    expect(isDispatchEligible(issue, state, config)).toBe(false);
  });

  it("New issue with active blocker is ineligible", () => {
    const issue = makeIssue({
      state: "New",
      blocked_by: [{ id: "10", identifier: "MT-10", state: "Active" }],
    });
    expect(isDispatchEligible(issue, makeState(), makeConfig())).toBe(false);
  });

  it("New issue with terminal blocker is eligible", () => {
    const issue = makeIssue({
      state: "New",
      blocked_by: [{ id: "10", identifier: "MT-10", state: "Done" }],
    });
    expect(isDispatchEligible(issue, makeState(), makeConfig())).toBe(true);
  });

  it("New issue with unknown blocker state is ineligible", () => {
    const issue = makeIssue({
      state: "New",
      blocked_by: [{ id: "10", identifier: "MT-10", state: null }],
    });
    expect(isDispatchEligible(issue, makeState(), makeConfig())).toBe(false);
  });
});

describe("orchestrator / state — sortForDispatch", () => {
  it("sorts by priority ascending", () => {
    const a = makeIssue({ id: "a", priority: 3 });
    const b = makeIssue({ id: "b", priority: 1 });
    const c = makeIssue({ id: "c", priority: 2 });
    const sorted = sortForDispatch([a, b, c]);
    expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("null priority sorts last", () => {
    const a = makeIssue({ id: "a", priority: null });
    const b = makeIssue({ id: "b", priority: 2 });
    const sorted = sortForDispatch([a, b]);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("same priority sorts by created_at oldest first", () => {
    const a = makeIssue({ id: "a", priority: 2, created_at: new Date("2025-02-01") });
    const b = makeIssue({ id: "b", priority: 2, created_at: new Date("2025-01-01") });
    const sorted = sortForDispatch([a, b]);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("tie-breaks by identifier", () => {
    const a = makeIssue({ id: "a", identifier: "MT-200", priority: 2, created_at: new Date("2025-01-01") });
    const b = makeIssue({ id: "b", identifier: "MT-100", priority: 2, created_at: new Date("2025-01-01") });
    const sorted = sortForDispatch([a, b]);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("orchestrator / state — availableSlots", () => {
  it("returns max when nothing running", () => {
    const state = makeState({ max_concurrent_agents: 5 });
    expect(availableSlots(state)).toBe(5);
  });

  it("returns 0 when at capacity", () => {
    const state = makeState({ max_concurrent_agents: 1 });
    state.running.set("x", {} as any);
    expect(availableSlots(state)).toBe(0);
  });
});

describe("orchestrator / state — calculateBackoff", () => {
  it("continuation returns 1000ms", () => {
    expect(calculateBackoff(1, true, 300000)).toBe(1000);
  });

  it("first failure retry is 10s", () => {
    expect(calculateBackoff(1, false, 300000)).toBe(10000);
  });

  it("second failure retry is 20s", () => {
    expect(calculateBackoff(2, false, 300000)).toBe(20000);
  });

  it("third failure retry is 40s", () => {
    expect(calculateBackoff(3, false, 300000)).toBe(40000);
  });

  it("backoff is capped at max", () => {
    expect(calculateBackoff(100, false, 300000)).toBe(300000);
  });
});

describe("orchestrator / state — nextAttempt", () => {
  it("null -> 1", () => {
    expect(nextAttempt(null)).toBe(1);
  });

  it("1 -> 2", () => {
    expect(nextAttempt(1)).toBe(2);
  });
});
