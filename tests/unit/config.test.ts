import { describe, it, expect } from "vitest";
import {
  loadWorkflow,
  parseWorkflowContent,
  WorkflowLoadError,
} from "../../src/config/workflow-loader.js";
import { resolveConfig, resolveEnvVar, expandPath } from "../../src/config/config.js";
import { validateDispatchConfig } from "../../src/config/validation.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---- Workflow Loader Tests ----

describe("parseWorkflowContent", () => {
  it("parses front matter + prompt body", () => {
    const raw = `---
tracker:
  kind: ado
  endpoint: https://dev.azure.com/org
---
You are working on {{ issue.identifier }}.`;

    const result = parseWorkflowContent(raw);
    expect(result.config).toEqual({
      tracker: { kind: "ado", endpoint: "https://dev.azure.com/org" },
    });
    expect(result.prompt_template).toBe(
      "You are working on {{ issue.identifier }}.",
    );
  });

  it("handles WORKFLOW.md without front matter", () => {
    const raw = "Just a prompt body\nwith multiple lines.";
    const result = parseWorkflowContent(raw);
    expect(result.config).toEqual({});
    expect(result.prompt_template).toBe(
      "Just a prompt body\nwith multiple lines.",
    );
  });

  it("returns empty config for empty front matter", () => {
    const raw = `---
---
Prompt body here.`;
    const result = parseWorkflowContent(raw);
    expect(result.config).toEqual({});
    expect(result.prompt_template).toBe("Prompt body here.");
  });

  it("rejects non-map YAML front matter (array)", () => {
    const raw = `---
- item1
- item2
---
Prompt.`;
    try {
      parseWorkflowContent(raw);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowLoadError);
      expect((e as WorkflowLoadError).code).toBe("workflow_front_matter_not_a_map");
    }
  });

  it("rejects non-map YAML front matter (scalar)", () => {
    const raw = `---
just a string
---
Prompt.`;
    try {
      parseWorkflowContent(raw);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowLoadError);
      expect((e as WorkflowLoadError).code).toBe("workflow_front_matter_not_a_map");
    }
  });

  it("errors on unclosed front matter", () => {
    const raw = `---
tracker:
  kind: ado`;
    try {
      parseWorkflowContent(raw);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowLoadError);
      expect((e as WorkflowLoadError).code).toBe("workflow_parse_error");
    }
  });

  it("trims prompt body", () => {
    const raw = `---
key: value
---

  padded prompt  

`;
    const result = parseWorkflowContent(raw);
    expect(result.prompt_template).toBe("padded prompt");
  });
});

describe("loadWorkflow", () => {
  const dir = join(tmpdir(), `symphony-test-${Date.now()}`);

  it("loads a valid file from disk", () => {
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "WORKFLOW.md");
    writeFileSync(
      filePath,
      `---\ntracker:\n  kind: ado\n---\nHello {{ issue.title }}\n`,
    );
    const result = loadWorkflow(filePath);
    expect(result.config).toHaveProperty("tracker");
    expect(result.prompt_template).toBe("Hello {{ issue.title }}");
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws missing_workflow_file for nonexistent path", () => {
    expect(() => loadWorkflow("/nonexistent/WORKFLOW.md")).toThrow(
      WorkflowLoadError,
    );
    try {
      loadWorkflow("/nonexistent/WORKFLOW.md");
    } catch (e) {
      expect((e as WorkflowLoadError).code).toBe("missing_workflow_file");
    }
  });
});

// ---- Config Layer Tests ----

describe("resolveEnvVar", () => {
  it("resolves $VAR from environment", () => {
    process.env.TEST_SYMPHONY_VAR = "secret123";
    expect(resolveEnvVar("$TEST_SYMPHONY_VAR")).toBe("secret123");
    delete process.env.TEST_SYMPHONY_VAR;
  });

  it("returns empty for unset env var", () => {
    delete process.env.UNSET_VAR_XYZ;
    expect(resolveEnvVar("$UNSET_VAR_XYZ")).toBe("");
  });

  it("returns literal if no $ prefix", () => {
    expect(resolveEnvVar("literal-value")).toBe("literal-value");
  });
});

describe("resolveConfig", () => {
  it("applies defaults for missing optional fields", () => {
    const config = resolveConfig({});
    expect(config.tracker.kind).toBe("");
    expect(config.tracker.active_states).toEqual(["New", "Active"]);
    expect(config.tracker.terminal_states).toEqual([
      "Closed",
      "Resolved",
      "Done",
      "Cancelled",
    ]);
    expect(config.polling.interval_ms).toBe(30000);
    expect(config.agent.max_concurrent_agents).toBe(10);
    expect(config.agent.max_turns).toBe(20);
    expect(config.agent.max_retry_backoff_ms).toBe(300000);
    expect(config.codex.command).toBe("codex app-server");
    expect(config.codex.turn_timeout_ms).toBe(3600000);
    expect(config.codex.read_timeout_ms).toBe(5000);
    expect(config.codex.stall_timeout_ms).toBe(300000);
    expect(config.hooks.timeout_ms).toBe(60000);
    expect(config.server.port).toBeNull();
  });

  it("parses active_states from comma-separated string", () => {
    const config = resolveConfig({
      tracker: { active_states: "New, Active, In Progress" },
    });
    expect(config.tracker.active_states).toEqual([
      "New",
      "Active",
      "In Progress",
    ]);
  });

  it("parses active_states from array", () => {
    const config = resolveConfig({
      tracker: { active_states: ["New", "Active"] },
    });
    expect(config.tracker.active_states).toEqual(["New", "Active"]);
  });

  it("coerces string integers to numbers", () => {
    const config = resolveConfig({
      polling: { interval_ms: "15000" },
      agent: { max_concurrent_agents: "5" },
    });
    expect(config.polling.interval_ms).toBe(15000);
    expect(config.agent.max_concurrent_agents).toBe(5);
  });

  it("normalizes per-state concurrency keys and drops invalid values", () => {
    const config = resolveConfig({
      agent: {
        max_concurrent_agents_by_state: {
          " Active ": 3,
          "NEW": 2,
          "Bad": -1,
          "Zero": 0,
          "NaN": "not-a-number",
        },
      },
    });
    expect(config.agent.max_concurrent_agents_by_state.get("active")).toBe(3);
    expect(config.agent.max_concurrent_agents_by_state.get("new")).toBe(2);
    expect(config.agent.max_concurrent_agents_by_state.has("bad")).toBe(false);
    expect(config.agent.max_concurrent_agents_by_state.has("zero")).toBe(false);
    expect(config.agent.max_concurrent_agents_by_state.has("nan")).toBe(false);
  });

  it("resolves $VAR in api_key", () => {
    process.env.TEST_ADO_PAT = "my-pat-token";
    const config = resolveConfig({
      tracker: { api_key: "$TEST_ADO_PAT" },
    });
    expect(config.tracker.api_key).toBe("my-pat-token");
    delete process.env.TEST_ADO_PAT;
  });

  it("treats empty resolved $VAR as missing api_key", () => {
    delete process.env.MISSING_PAT;
    const config = resolveConfig({
      tracker: { api_key: "$MISSING_PAT" },
    });
    expect(config.tracker.api_key).toBe("");
  });

  it("non-positive hook timeout falls back to default", () => {
    const config = resolveConfig({
      hooks: { timeout_ms: -100 },
    });
    expect(config.hooks.timeout_ms).toBe(60000);
  });
});

// ---- Validation Tests ----

describe("validateDispatchConfig", () => {
  function validConfig() {
    return resolveConfig({
      tracker: {
        kind: "ado",
        endpoint: "https://dev.azure.com/org",
        api_key: "my-pat",
        project_slug: "MyProject",
      },
      codex: { command: "codex app-server" },
    });
  }

  it("passes with valid config", () => {
    const result = validateDispatchConfig(validConfig());
    expect(result.ok).toBe(true);
  });

  it("fails when tracker.kind is missing", () => {
    const cfg = validConfig();
    cfg.tracker.kind = "";
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0].code).toBe("missing_tracker_kind");
  });

  it("fails when tracker.kind is unsupported", () => {
    const cfg = validConfig();
    cfg.tracker.kind = "jira";
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0].code).toBe("unsupported_tracker_kind");
  });

  it("fails when api_key is missing for ado", () => {
    const cfg = validConfig();
    cfg.tracker.api_key = "";
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("missing_tracker_api_key");
    }
  });

  it("fails when project_slug is missing for ado", () => {
    const cfg = validConfig();
    cfg.tracker.project_slug = "";
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("missing_tracker_project_slug");
    }
  });

  it("fails when codex.command is empty", () => {
    const cfg = validConfig();
    cfg.codex.command = "";
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("missing_codex_command");
    }
  });

  it("collects multiple errors at once", () => {
    const cfg = resolveConfig({
      tracker: { kind: "ado" },
    });
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // kind=ado but missing endpoint, api_key, and project_slug
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
