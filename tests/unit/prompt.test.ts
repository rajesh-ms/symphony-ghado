import { describe, it, expect } from "vitest";
import { renderPrompt, PromptRenderError } from "../../src/prompt/renderer.js";
import type { Issue } from "../../src/types.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "42",
    identifier: "MT-42",
    title: "Fix the widget",
    description: "Widget is broken, need to fix it.",
    priority: 2,
    state: "Active",
    work_item_type: null,
    branch_name: null,
    url: "https://dev.azure.com/org/proj/_workitems/edit/42",
    labels: ["bug", "p2"],
    blocked_by: [],
    created_at: "2025-01-15T10:00:00.000Z",
    updated_at: "2025-01-16T11:00:00.000Z",
    ...overrides,
  };
}

describe("Prompt Renderer", () => {
  it("renders basic issue fields", async () => {
    const tpl = "Work on {{ issue.identifier }}: {{ issue.title }}";
    const result = await renderPrompt(tpl, makeIssue(), null);
    expect(result).toBe("Work on MT-42: Fix the widget");
  });

  it("renders attempt variable", async () => {
    const tpl = "Attempt: {{ attempt }}";
    const result = await renderPrompt(tpl, makeIssue(), 3);
    expect(result).toBe("Attempt: 3");
  });

  it("renders null attempt as empty", async () => {
    const tpl = "{% if attempt %}Retry {{ attempt }}{% else %}First run{% endif %}";
    const result = await renderPrompt(tpl, makeIssue(), null);
    expect(result).toBe("First run");
  });

  it("renders labels array", async () => {
    const tpl = "Labels: {% for l in issue.labels %}{{ l }} {% endfor %}";
    const result = await renderPrompt(tpl, makeIssue({ labels: ["bug", "urgent"] }), null);
    expect(result.trim()).toBe("Labels: bug urgent");
  });

  it("renders blocked_by array", async () => {
    const tpl = "Blockers: {% for b in issue.blocked_by %}{{ b.identifier }} {% endfor %}";
    const issue = makeIssue({
      blocked_by: [
        { id: "10", identifier: "MT-10", state: "Active" },
        { id: "11", identifier: "MT-11", state: "Done" },
      ],
    });
    const result = await renderPrompt(tpl, issue, null);
    expect(result.trim()).toBe("Blockers: MT-10 MT-11");
  });

  it("renders issue description", async () => {
    const tpl = "Desc: {{ issue.description }}";
    const result = await renderPrompt(tpl, makeIssue(), null);
    expect(result).toBe("Desc: Widget is broken, need to fix it.");
  });

  it("renders null description as empty", async () => {
    const tpl = "Desc: {{ issue.description }}";
    const result = await renderPrompt(tpl, makeIssue({ description: null }), null);
    expect(result).toBe("Desc: ");
  });

  it("renders date fields as ISO strings", async () => {
    const tpl = "Created: {{ issue.created_at }}";
    const result = await renderPrompt(tpl, makeIssue(), null);
    expect(result).toBe("Created: 2025-01-15T10:00:00.000Z");
  });

  it("falls back to default prompt when template is empty", async () => {
    const result = await renderPrompt("", makeIssue(), null);
    expect(result).toBe("You are working on a work item from Azure DevOps.");
  });

  it("falls back to default prompt when template is whitespace only", async () => {
    const result = await renderPrompt("   \n\t  ", makeIssue(), null);
    expect(result).toBe("You are working on a work item from Azure DevOps.");
  });

  it("throws PromptRenderError on unknown variable (strict)", async () => {
    const tpl = "{{ unknown_var }}";
    await expect(renderPrompt(tpl, makeIssue(), null)).rejects.toThrow(
      PromptRenderError,
    );
  });

  it("renders priority and state", async () => {
    const tpl = "P{{ issue.priority }} - {{ issue.state }}";
    const result = await renderPrompt(tpl, makeIssue(), null);
    expect(result).toBe("P2 - Active");
  });

  it("renders url", async () => {
    const tpl = "Link: {{ issue.url }}";
    const result = await renderPrompt(tpl, makeIssue(), null);
    expect(result).toContain("https://dev.azure.com/org/proj/_workitems/edit/42");
  });
});
