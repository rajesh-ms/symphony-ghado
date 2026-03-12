// ---------------------------------------------------------------------------
// ADO Payload → Issue Normalization — Section 11.3
// ---------------------------------------------------------------------------

import type { Issue, BlockerRef } from "../types.js";

export interface AdoWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: AdoRelation[];
  _links?: { html?: { href?: string } };
}

export interface AdoRelation {
  rel: string;
  url: string;
  attributes?: Record<string, unknown>;
}

/**
 * Normalize an ADO work item payload into our Issue model.
 */
export function normalizeAdoWorkItem(
  item: AdoWorkItem,
  orgUrl: string,
  projectSlug: string,
): Issue {
  const f = item.fields;

  // Priority: integer only, non-integers become null
  let priority: number | null = null;
  const rawPriority = f["Microsoft.VSTS.Common.Priority"];
  if (typeof rawPriority === "number" && Number.isInteger(rawPriority)) {
    priority = rawPriority;
  }

  // Labels from System.Tags (semicolon-separated), normalized to lowercase
  const rawTags = f["System.Tags"];
  const labels: string[] =
    typeof rawTags === "string"
      ? rawTags
          .split(";")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];

  // Blockers from relations of type System.LinkTypes.BlockedBy
  const blocked_by: BlockerRef[] = [];
  if (item.relations) {
    for (const rel of item.relations) {
      if (
        rel.rel === "System.LinkTypes.Dependency-Reverse" ||
        rel.rel === "System.LinkTypes.BlockedBy"
      ) {
        // Extract work item ID from the relation URL
        const idMatch = rel.url.match(/workItems\/(\d+)/);
        const relId = idMatch ? idMatch[1] : null;
        blocked_by.push({
          id: relId,
          identifier: relId,
          state: null, // state not available from relation data alone
        });
      }
    }
  }

  // Timestamps
  const created_at = parseTimestamp(f["System.CreatedDate"]);
  const updated_at = parseTimestamp(f["System.ChangedDate"]);

  // URL: prefer _links.html.href, fallback to constructed URL
  const htmlUrl = item._links?.html?.href;
  const url =
    htmlUrl ??
    `${orgUrl.replace(/\/$/, "")}/${encodeURIComponent(projectSlug)}/_workitems/edit/${item.id}`;

  return {
    id: String(item.id),
    identifier: String(item.id),
    title: String(f["System.Title"] ?? ""),
    description:
      f["System.Description"] != null
        ? String(f["System.Description"])
        : null,
    priority,
    state: String(f["System.State"] ?? ""),
    branch_name: null, // ADO doesn't expose branch in standard fields
    url,
    labels,
    blocked_by,
    created_at,
    updated_at,
  };
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    // Validate ISO-8601 parse
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
