// ---------------------------------------------------------------------------
// Prompt Renderer — Section 12
// Strict Liquid-compatible template rendering for issue prompts.
// ---------------------------------------------------------------------------

import { Liquid } from "liquidjs";
import type { Issue } from "../types.js";

const DEFAULT_PROMPT = "You are working on a work item from Azure DevOps.";

export class PromptRenderError extends Error {
  constructor(
    public readonly code: "template_parse_error" | "template_render_error",
    message: string,
  ) {
    super(message);
    this.name = "PromptRenderError";
  }
}

/**
 * Render the workflow prompt template with issue data.
 *
 * @param template - Liquid-flavored Markdown from WORKFLOW.md body (may be empty)
 * @param issue    - Normalized issue record
 * @param attempt  - null for first run, integer for retry/continuation
 */
export async function renderPrompt(
  template: string,
  issue: Issue,
  attempt: number | null,
): Promise<string> {
  const effectiveTemplate = template.trim() || DEFAULT_PROMPT;

  const engine = new Liquid({
    strictVariables: true,
    strictFilters: true,
  });

  // Convert issue to plain object for template compatibility
  const issueData: Record<string, unknown> = {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    state: issue.state,
    branch_name: issue.branch_name,
    url: issue.url,
    labels: issue.labels,
    blocked_by: issue.blocked_by.map((b) => ({
      id: b.id,
      identifier: b.identifier,
      state: b.state,
    })),
    created_at: issue.created_at ?? null,
    updated_at: issue.updated_at ?? null,
  };

  try {
    const tpl = engine.parse(effectiveTemplate);
    const result = await engine.render(tpl, { issue: issueData, attempt });
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // LiquidJS parse errors happen during parse(), render errors during render()
    const code = msg.includes("parse")
      ? "template_parse_error"
      : "template_render_error";
    throw new PromptRenderError(code, msg);
  }
}
