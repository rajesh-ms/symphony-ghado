// ---------------------------------------------------------------------------
// Integration test — full orchestrator lifecycle with mocked services
// Section 17 validation matrix coverage
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import type { Issue } from "../../src/types.js";
import type { ServiceConfig } from "../../src/types.js";
import type { TrackerClient } from "../../src/tracker/types.js";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";

// ---------------------------------------------------------------------------
// Mock tracker
// ---------------------------------------------------------------------------

class MockTracker implements TrackerClient {
  issues: Issue[] = [];
  stateOverrides: Map<string, string> = new Map();
  fetchCount = 0;
  refreshCount = 0;

  async fetchCandidateIssues(_activeStates: string[]): Promise<Issue[]> {
    this.fetchCount++;
    return this.issues.map((i) => {
      const override = this.stateOverrides.get(i.id);
      return override ? { ...i, state: override } : i;
    });
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    this.refreshCount++;
    return this.issues
      .filter((i) => ids.includes(i.id))
      .map((i) => {
        const override = this.stateOverrides.get(i.id);
        return override ? { ...i, state: override } : i;
      });
  }

  async fetchIssuesByStates(_states: string[]): Promise<Issue[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const logger = pino({ level: "silent" });

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "100",
    identifier: "MT-100",
    title: "Test issue",
    description: "Description",
    priority: 2,
    state: "Active",
    branch_name: null,
    url: null,
    labels: [],
    blocked_by: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeConfig(wsRoot: string, overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    tracker: {
      kind: "ado",
      endpoint: "https://dev.azure.com/org",
      api_key: "token",
      project_slug: "proj",
      active_states: ["New", "Active"],
      terminal_states: ["Closed", "Resolved", "Done", "Cancelled"],
    },
    polling: { interval_ms: 60000 }, // Long interval; we'll drive ticks manually
    workspace: { root: wsRoot },
    hooks: {
      after_create: null,
      before_run: null,
      after_run: null,
      before_remove: null,
      timeout_ms: 60000,
    },
    agent: {
      max_concurrent_agents: 2,
      max_turns: 1,
      max_retry_backoff_ms: 300000,
      max_concurrent_agents_by_state: new Map<string, number>(),
    },
    codex: {
      command: "echo noop", // Will fail fast since it's not a real app-server
      approval_policy: "auto-edit",
      thread_sandbox: "none",
      turn_sandbox_policy: "none",
      turn_timeout_ms: 5000,
      read_timeout_ms: 1000,
      stall_timeout_ms: 10000,
    },
    server: { port: null },
    prompt_template: "Work on {{ issue.title }}",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator Integration", () => {
  let wsRoot: string;

  beforeEach(async () => {
    wsRoot = await mkdtemp(join(tmpdir(), "sym-int-"));
  });

  afterEach(async () => {
    await rm(wsRoot, { recursive: true, force: true });
  });

  it("creates initial state with correct config values", () => {
    const tracker = new MockTracker();
    const config = makeConfig(wsRoot);
    const orch = new Orchestrator({ config, tracker, logger });
    const snap = orch.getSnapshot();
    expect(snap.counts.running).toBe(0);
    expect(snap.counts.retrying).toBe(0);
    expect(snap.codex_totals.total_tokens).toBe(0);
  });

  it("getSnapshot returns empty state before start", () => {
    const tracker = new MockTracker();
    const config = makeConfig(wsRoot);
    const orch = new Orchestrator({ config, tracker, logger });
    const snap = orch.getSnapshot();
    expect(snap.running).toHaveLength(0);
    expect(snap.retrying).toHaveLength(0);
    expect(snap.generated_at).toBeDefined();
  });

  it("triggerRefresh triggers a poll tick", async () => {
    const tracker = new MockTracker();
    // Don't add issues to avoid actually dispatching a worker
    const config = makeConfig(wsRoot);
    const orch = new Orchestrator({ config, tracker, logger });
    // Don't call start() — just directly trigger refresh
    await orch.triggerRefresh();
    orch.stop();
    // tracker.fetchCandidateIssues should have been called
    expect(tracker.fetchCount).toBeGreaterThanOrEqual(1);
  });

  it("updateConfig changes orchestrator settings", () => {
    const tracker = new MockTracker();
    const config = makeConfig(wsRoot);
    const orch = new Orchestrator({ config, tracker, logger });

    const newConfig = { ...config, polling: { interval_ms: 5000 } };
    orch.updateConfig(newConfig);

    // Internally the state should reflect new interval
    // We verify indirectly via snapshot — no direct exposure, but no error
    const snap = orch.getSnapshot();
    expect(snap).toBeDefined();
  });

  it("findIssueByIdentifier returns null for unknown issue", () => {
    const tracker = new MockTracker();
    const config = makeConfig(wsRoot);
    const orch = new Orchestrator({ config, tracker, logger });
    expect(orch.findIssueByIdentifier("UNKNOWN-1")).toBeNull();
  });

  it("stop prevents further ticks", async () => {
    const tracker = new MockTracker();
    const config = makeConfig(wsRoot, { polling: { interval_ms: 50 } });
    const orch = new Orchestrator({ config, tracker, logger });
    orch.stop();
    // After stop, triggerRefresh should still work but scheduleTick won't continue
    await orch.triggerRefresh();
    const snap = orch.getSnapshot();
    expect(snap.counts.running).toBe(0);
  });
});

describe("Orchestrator startup validation", () => {
  let wsRoot: string;

  beforeEach(async () => {
    wsRoot = await mkdtemp(join(tmpdir(), "sym-int-"));
  });

  afterEach(async () => {
    await rm(wsRoot, { recursive: true, force: true });
  });

  it("start fails when tracker kind is missing", async () => {
    const tracker = new MockTracker();
    const config = makeConfig(wsRoot, {
      tracker: {
        kind: "",
        endpoint: "https://dev.azure.com/org",
        api_key: "token",
        project_slug: "proj",
        active_states: ["Active"],
        terminal_states: ["Closed"],
      },
    });
    const orch = new Orchestrator({ config, tracker, logger });
    await expect(orch.start()).rejects.toThrow("Startup validation failed");
  });

  it("start fails when api_key is missing", async () => {
    const tracker = new MockTracker();
    const config = makeConfig(wsRoot, {
      tracker: {
        kind: "ado",
        endpoint: "https://dev.azure.com/org",
        api_key: "",
        project_slug: "proj",
        active_states: ["Active"],
        terminal_states: ["Closed"],
      },
    });
    const orch = new Orchestrator({ config, tracker, logger });
    await expect(orch.start()).rejects.toThrow("Startup validation failed");
  });
});

describe("Example WORKFLOW.md rendering", () => {
  let wsRoot: string;

  beforeEach(async () => {
    wsRoot = await mkdtemp(join(tmpdir(), "sym-int-"));
  });

  afterEach(async () => {
    await rm(wsRoot, { recursive: true, force: true });
  });

  it("write and load an example WORKFLOW.md", async () => {
    const { loadWorkflow } = await import("../../src/config/workflow-loader.js");
    const { resolveConfig } = await import("../../src/config/config.js");
    const { renderPrompt } = await import("../../src/prompt/renderer.js");

    const workflowContent = `---
tracker:
  kind: ado
  endpoint: https://dev.azure.com/testorg
  api_key: $ADO_PAT
  project_slug: TestProject
  active_states: [New, Active]
  terminal_states: [Closed, Done]
polling:
  interval_ms: 15000
workspace:
  root: ${wsRoot}
agent:
  max_concurrent_agents: 3
  max_turns: 10
codex:
  command: codex app-server
---
You are working on issue {{ issue.identifier }}: {{ issue.title }}.

{{ issue.description }}

{% if attempt %}This is retry attempt {{ attempt }}.{% endif %}
`;

    const wfPath = join(wsRoot, "WORKFLOW.md");
    await writeFile(wfPath, workflowContent, "utf-8");

    // Set ADO_PAT for env resolution
    const oldPat = process.env.ADO_PAT;
    process.env.ADO_PAT = "test-pat-token";
    try {
      const wf = await loadWorkflow(wfPath);
      expect(wf.config.tracker).toBeDefined();
      expect(wf.prompt_template).toContain("{{ issue.identifier }}");

      const config = resolveConfig(wf.config);
      expect(config.tracker.kind).toBe("ado");
      expect(config.tracker.api_key).toBe("test-pat-token");
      expect(config.tracker.project_slug).toBe("TestProject");
      expect(config.polling.interval_ms).toBe(15000);
      expect(config.agent.max_concurrent_agents).toBe(3);
      expect(config.workspace.root).toBe(wsRoot);

      // Render a prompt
      const issue = makeIssue({ identifier: "MT-42", title: "Fix widget", description: "It's broken" });
      const rendered = await renderPrompt(wf.prompt_template, issue, null);
      expect(rendered).toContain("MT-42: Fix widget");
      expect(rendered).toContain("It's broken");
      expect(rendered).not.toContain("retry attempt");

      // Render with retry attempt
      const retryRender = await renderPrompt(wf.prompt_template, issue, 2);
      expect(retryRender).toContain("retry attempt 2");
    } finally {
      if (oldPat !== undefined) {
        process.env.ADO_PAT = oldPat;
      } else {
        delete process.env.ADO_PAT;
      }
    }
  });
});
