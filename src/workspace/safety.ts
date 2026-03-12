// ---------------------------------------------------------------------------
// Workspace Safety — Section 9.5
// Path sanitization, containment validation.
// ---------------------------------------------------------------------------

import { resolve, normalize, sep } from "node:path";
import { sanitizeWorkspaceKey } from "../types.js";

export { sanitizeWorkspaceKey };

/**
 * Compute the absolute workspace path for an issue identifier.
 */
export function resolveWorkspacePath(
  root: string,
  identifier: string,
): string {
  const key = sanitizeWorkspaceKey(identifier);
  return resolve(root, key);
}

/**
 * Validate that the workspace path is contained inside the workspace root.
 * Throws if the path escapes the root (path traversal protection).
 */
export function validateWorkspaceContainment(
  root: string,
  wsPath: string,
): void {
  const absRoot = normalize(resolve(root));
  const absWs = normalize(resolve(wsPath));

  // Ensure wsPath starts with root (directory prefix, not just string prefix)
  const rootPrefix = absRoot.endsWith(sep) ? absRoot : absRoot + sep;

  if (!absWs.startsWith(rootPrefix) && absWs !== absRoot) {
    throw new Error(
      `Workspace path '${absWs}' is outside workspace root '${absRoot}'`,
    );
  }
}
