import { describe, it, expect } from "vitest";
import {
  normalizeAdoWorkItem,
  type AdoWorkItem,
} from "../../src/tracker/normalize.js";

function makeWorkItem(overrides: Partial<AdoWorkItem> = {}): AdoWorkItem {
  return {
    id: 123,
    fields: {
      "System.Title": "Fix the bug",
      "System.State": "Active",
      "System.Description": "Some description",
      "Microsoft.VSTS.Common.Priority": 2,
      "System.Tags": "Frontend; Backend; Testing",
      "System.CreatedDate": "2026-01-15T10:30:00Z",
      "System.ChangedDate": "2026-02-20T14:00:00Z",
    },
    relations: [],
    _links: { html: { href: "https://dev.azure.com/org/proj/_workitems/edit/123" } },
    ...overrides,
  };
}

describe("normalizeAdoWorkItem", () => {
  const orgUrl = "https://dev.azure.com/org";
  const project = "MyProject";

  it("normalizes a full ADO work item", () => {
    const item = makeWorkItem();
    const issue = normalizeAdoWorkItem(item, orgUrl, project);

    expect(issue.id).toBe("123");
    expect(issue.identifier).toBe("123");
    expect(issue.title).toBe("Fix the bug");
    expect(issue.state).toBe("Active");
    expect(issue.description).toBe("Some description");
    expect(issue.priority).toBe(2);
    expect(issue.url).toBe("https://dev.azure.com/org/proj/_workitems/edit/123");
    expect(issue.created_at).toBe("2026-01-15T10:30:00.000Z");
    expect(issue.updated_at).toBe("2026-02-20T14:00:00.000Z");
  });

  it("normalizes labels to lowercase from semicolon-separated tags", () => {
    const item = makeWorkItem({
      fields: {
        ...makeWorkItem().fields,
        "System.Tags": "Frontend; BACKEND; Testing ",
      },
    });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.labels).toEqual(["frontend", "backend", "testing"]);
  });

  it("handles empty tags", () => {
    const item = makeWorkItem({
      fields: { ...makeWorkItem().fields, "System.Tags": undefined },
    });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.labels).toEqual([]);
  });

  it("extracts blockers from relations", () => {
    const item = makeWorkItem({
      relations: [
        {
          rel: "System.LinkTypes.Dependency-Reverse",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/456",
        },
        {
          rel: "System.LinkTypes.Related",
          url: "https://dev.azure.com/org/proj/_apis/wit/workItems/789",
        },
      ],
    });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.blocked_by).toHaveLength(1);
    expect(issue.blocked_by[0].id).toBe("456");
    expect(issue.blocked_by[0].identifier).toBe("456");
  });

  it("handles priority: valid integer", () => {
    const item = makeWorkItem({
      fields: { ...makeWorkItem().fields, "Microsoft.VSTS.Common.Priority": 1 },
    });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.priority).toBe(1);
  });

  it("handles priority: non-integer becomes null", () => {
    const item = makeWorkItem({
      fields: {
        ...makeWorkItem().fields,
        "Microsoft.VSTS.Common.Priority": "High",
      },
    });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.priority).toBeNull();
  });

  it("handles priority: float becomes null", () => {
    const item = makeWorkItem({
      fields: {
        ...makeWorkItem().fields,
        "Microsoft.VSTS.Common.Priority": 2.5,
      },
    });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.priority).toBeNull();
  });

  it("constructs URL when _links.html.href is absent", () => {
    const item = makeWorkItem({ _links: undefined });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.url).toBe(
      "https://dev.azure.com/org/MyProject/_workitems/edit/123",
    );
  });

  it("handles null description", () => {
    const item = makeWorkItem({
      fields: { ...makeWorkItem().fields, "System.Description": undefined },
    });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.description).toBeNull();
  });

  it("handles invalid timestamp", () => {
    const item = makeWorkItem({
      fields: {
        ...makeWorkItem().fields,
        "System.CreatedDate": "not-a-date",
      },
    });
    const issue = normalizeAdoWorkItem(item, orgUrl, project);
    expect(issue.created_at).toBeNull();
  });
});
