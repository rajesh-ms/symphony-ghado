// ---------------------------------------------------------------------------
// Azure DevOps REST Client — Section 11
// ---------------------------------------------------------------------------

import type { Issue } from "../types.js";
import type { TrackerClient } from "./types.js";
import { normalizeAdoWorkItem, type AdoWorkItem } from "./normalize.js";

const ADO_API_VERSION = "7.1";
const PAGE_SIZE = 200;
const NETWORK_TIMEOUT_MS = 30000;

export class AdoApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AdoApiError";
  }
}

export class AdoClient implements TrackerClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly projectSlug: string;

  constructor(endpoint: string, apiKey: string, projectSlug: string) {
    this.baseUrl = endpoint.replace(/\/$/, "");
    this.projectSlug = projectSlug;
    // HTTP Basic: empty username, PAT as password
    this.authHeader =
      "Basic " + Buffer.from(`:${apiKey}`).toString("base64");
  }

  async fetchCandidateIssues(activeStates: string[]): Promise<Issue[]> {
    if (activeStates.length === 0) return [];

    const stateFilter = activeStates
      .map((s) => `'${s.replace(/'/g, "''")}'`)
      .join(", ");

    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] IN (${stateFilter})`;

    const ids = await this.executeWiql(wiql);
    if (ids.length === 0) return [];

    return this.fetchWorkItemDetails(ids);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    if (ids.length === 0) return [];
    const numericIds = ids.map(Number).filter((n) => !isNaN(n));
    if (numericIds.length === 0) return [];

    return this.fetchWorkItemDetails(numericIds);
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    if (states.length === 0) return [];

    const stateFilter = states
      .map((s) => `'${s.replace(/'/g, "''")}'`)
      .join(", ");

    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] IN (${stateFilter})`;

    const ids = await this.executeWiql(wiql);
    if (ids.length === 0) return [];

    return this.fetchWorkItemDetails(ids);
  }

  async assignIssue(issueId: string): Promise<void> {
    const email = await this.fetchCurrentUserEmail();
    const url = `${this.baseUrl}/${encodeURIComponent(this.projectSlug)}/_apis/wit/workitems/${issueId}?api-version=${ADO_API_VERSION}`;
    await this.request(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json-patch+json" },
      body: JSON.stringify([
        { op: "replace", path: "/fields/System.AssignedTo", value: email },
      ]),
    });
  }

  // ---- Internal helpers ----

  private async fetchCurrentUserEmail(): Promise<string> {
    const url = `${this.baseUrl}/_apis/connectionData`;
    const response = await this.request(url, { method: "GET" });
    const data = (await response.json()) as {
      authenticatedUser?: {
        properties?: {
          Account?: { $value?: string };
        };
      };
    };
    const email = data.authenticatedUser?.properties?.Account?.$value;
    if (!email) {
      throw new AdoApiError(
        "ado_api_identity",
        "Could not resolve authenticated user email from connectionData",
      );
    }
    return email;
  }

  private async executeWiql(query: string): Promise<number[]> {
    const url = `${this.baseUrl}/${encodeURIComponent(this.projectSlug)}/_apis/wit/wiql?api-version=${ADO_API_VERSION}&$top=${PAGE_SIZE}`;

    const response = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const data = (await response.json()) as {
      workItems?: { id: number }[];
    };

    if (!data.workItems) {
      return [];
    }

    return data.workItems.map((wi) => wi.id);
  }

  private async fetchWorkItemDetails(ids: number[]): Promise<Issue[]> {
    const issues: Issue[] = [];

    // Batch in groups of 200 (ADO limit)
    for (let i = 0; i < ids.length; i += PAGE_SIZE) {
      const batch = ids.slice(i, i + PAGE_SIZE);
      const idList = batch.join(",");
      const url = `${this.baseUrl}/${encodeURIComponent(this.projectSlug)}/_apis/wit/workitems?ids=${idList}&$expand=relations&api-version=${ADO_API_VERSION}`;

      const response = await this.request(url, { method: "GET" });
      const data = (await response.json()) as {
        value?: AdoWorkItem[];
      };

      if (data.value) {
        for (const item of data.value) {
          issues.push(
            normalizeAdoWorkItem(item, this.baseUrl, this.projectSlug),
          );
        }
      }
    }

    return issues;
  }

  private async request(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      NETWORK_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...((init.headers as Record<string, string>) ?? {}),
          Authorization: this.authHeader,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        let body = "";
        try {
          body = await response.text();
        } catch {
          // ignore body read failures
        }
        throw new AdoApiError(
          "ado_api_status",
          `ADO API returned ${response.status}: ${body}`,
          response.status,
        );
      }

      return response;
    } catch (e) {
      if (e instanceof AdoApiError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new AdoApiError(
          "ado_api_request",
          "ADO API request timed out",
        );
      }
      throw new AdoApiError(
        "ado_api_request",
        `ADO API request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
