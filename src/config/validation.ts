// ---------------------------------------------------------------------------
// Dispatch Preflight Validation — Section 6.3
// ---------------------------------------------------------------------------

import type { ServiceConfig, ValidationResult } from "../types.js";

/**
 * Validate the config needed to poll and launch workers.
 */
export function validateDispatchConfig(
  config: ServiceConfig,
): ValidationResult {
  const errors: { code: string; message: string }[] = [];

  if (!config.tracker.kind) {
    errors.push({
      code: "missing_tracker_kind",
      message: "tracker.kind is required",
    });
  } else if (config.tracker.kind !== "ado") {
    errors.push({
      code: "unsupported_tracker_kind",
      message: `tracker.kind '${config.tracker.kind}' is not supported (expected 'ado')`,
    });
  }

  if (config.tracker.kind === "ado") {
    if (!config.tracker.endpoint) {
      errors.push({
        code: "missing_tracker_endpoint",
        message: "tracker.endpoint is required when tracker.kind is 'ado'",
      });
    }
    if (!config.tracker.api_key) {
      errors.push({
        code: "missing_tracker_api_key",
        message:
          "tracker.api_key is required (use $ADO_PAT for env var indirection)",
      });
    }
    if (!config.tracker.project_slug) {
      errors.push({
        code: "missing_tracker_project_slug",
        message: "tracker.project_slug is required when tracker.kind is 'ado'",
      });
    }
  }

  if (!config.codex.command) {
    errors.push({
      code: "missing_codex_command",
      message: "codex.command must be a non-empty string",
    });
  }

  return errors.length === 0
    ? { ok: true }
    : { ok: false, errors };
}
