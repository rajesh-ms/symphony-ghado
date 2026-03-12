import { describe, expect, it } from "vitest";
import { getRegistryCatalog } from "../../src/registry/catalog.js";

describe("Registry catalog", () => {
  it("returns combined agent and MCP server entries with derived filters", () => {
    const catalog = getRegistryCatalog(new Date("2026-03-12T12:00:00.000Z"));

    expect(catalog.generated_at).toBe("2026-03-12T12:00:00.000Z");
    expect(catalog.counts).toEqual({
      total: 6,
      agents: 3,
      mcp_servers: 3,
    });
    expect(catalog.entries).toHaveLength(6);
    expect(catalog.entries[0]?.featured).toBe(true);
    expect(catalog.entries.some((entry) => entry.type === "agent")).toBe(true);
    expect(catalog.entries.some((entry) => entry.type === "mcp_server")).toBe(true);
    expect(catalog.filters.tags).toContain("engineering");
    expect(catalog.filters.capabilities).toContain("issue lookup");
    expect(catalog.filters.capabilities).toEqual([...catalog.filters.capabilities].sort((left, right) => left.localeCompare(right)));
  });
});
