// ---------------------------------------------------------------------------
// Workflow Loader — Section 5 of the Symphony prodspec
// Reads WORKFLOW.md, parses YAML front matter + prompt body.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { WorkflowDefinition } from "../types.js";

export class WorkflowLoadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowLoadError";
  }
}

/**
 * Load and parse a WORKFLOW.md file.
 * Returns { config, prompt_template }.
 */
export function loadWorkflow(filePath: string): WorkflowDefinition {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new WorkflowLoadError(
      "missing_workflow_file",
      `Cannot read workflow file: ${filePath}`,
    );
  }

  return parseWorkflowContent(raw);
}

/**
 * Parse raw WORKFLOW.md content into a WorkflowDefinition.
 */
export function parseWorkflowContent(raw: string): WorkflowDefinition {
  const lines = raw.split("\n");

  // Check for YAML front matter delimiters
  if (lines[0]?.trim() === "---") {
    const endIndex = findFrontMatterEnd(lines);
    if (endIndex === -1) {
      throw new WorkflowLoadError(
        "workflow_parse_error",
        "YAML front matter opening '---' found but no closing '---'",
      );
    }

    const yamlBlock = lines.slice(1, endIndex).join("\n");
    const promptBody = lines.slice(endIndex + 1).join("\n").trim();

    let config: unknown;
    try {
      config = parseYaml(yamlBlock);
    } catch (e) {
      throw new WorkflowLoadError(
        "workflow_parse_error",
        `Failed to parse YAML front matter: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // null/undefined YAML → empty map
    if (config == null) {
      config = {};
    }

    if (typeof config !== "object" || Array.isArray(config)) {
      throw new WorkflowLoadError(
        "workflow_front_matter_not_a_map",
        "YAML front matter must be a map/object",
      );
    }

    return {
      config: config as Record<string, unknown>,
      prompt_template: promptBody,
    };
  }

  // No front matter — entire file is the prompt body
  return {
    config: {},
    prompt_template: raw.trim(),
  };
}

function findFrontMatterEnd(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return i;
    }
  }
  return -1;
}
