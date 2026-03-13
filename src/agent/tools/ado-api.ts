// ---------------------------------------------------------------------------
// ADO API Tool Extension — Section 10.5 (optional client-side tool)
// Executes REST API calls against Azure DevOps using Symphony's configured auth.
// ---------------------------------------------------------------------------

import type { TrackerConfig } from "../../types.js";

export interface AdoToolInput {
  method?: string;
  path?: string;
  body?: Record<string, unknown>;
  wiql?: string;
}

export interface AdoToolResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/**
 * Execute an ADO API tool call using the configured tracker auth.
 */
export async function executeAdoTool(
  input: AdoToolInput,
  trackerConfig: TrackerConfig,
): Promise<AdoToolResult> {
  if (trackerConfig.kind !== "ado") {
    return { success: false, error: "ado_api tool requires tracker.kind=ado" };
  }
  if (!trackerConfig.api_key) {
    return { success: false, error: "Missing tracker API key for ado_api" };
  }
  if (!trackerConfig.endpoint) {
    return { success: false, error: "Missing tracker endpoint for ado_api" };
  }

  const baseUrl = trackerConfig.endpoint.replace(/\/+$/, "");
  const auth = Buffer.from(`:${trackerConfig.api_key}`).toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };

  try {
    // WIQL shorthand
    if (input.wiql) {
      const project = trackerConfig.project_slug;
      const wiqlUrl = `${baseUrl}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`;
      const resp = await fetch(wiqlUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: input.wiql }),
      });
      const data = await resp.json();
      if (resp.ok) {
        return { success: true, status: resp.status, data };
      }
      return { success: false, status: resp.status, data };
    }

    // Standard REST call
    if (!input.method || !input.path) {
      return {
        success: false,
        error: "ado_api requires method+path or wiql",
      };
    }

    const allowed = ["GET", "POST", "PATCH", "DELETE"];
    if (!allowed.includes(input.method.toUpperCase())) {
      return {
        success: false,
        error: `Unsupported HTTP method: ${input.method}`,
      };
    }

    const url = `${baseUrl}${input.path}`;
    const reqHeaders = { ...headers };
    // ADO work item PATCH requires json-patch+json content type
    if (input.method.toUpperCase() === "PATCH" && input.path?.includes("_apis/wit/workitems")) {
      reqHeaders["Content-Type"] = "application/json-patch+json";
    }
    const fetchOptions: RequestInit = {
      method: input.method.toUpperCase(),
      headers: reqHeaders,
    };
    if (input.body && input.method.toUpperCase() !== "GET") {
      fetchOptions.body = JSON.stringify(input.body);
    }

    const resp = await fetch(url, fetchOptions);
    const data = await resp.json().catch(() => null);

    if (resp.ok) {
      return { success: true, status: resp.status, data };
    }
    return { success: false, status: resp.status, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Transport error: ${msg}` };
  }
}

/**
 * Tool spec for advertising ado_api to the app-server session.
 */
export const adoApiToolSpec = {
  name: "ado_api",
  description:
    "Execute a REST API call against Azure DevOps using the current session's tracker auth.",
  parameters: {
    type: "object",
    properties: {
      method: {
        type: "string",
        enum: ["GET", "POST", "PATCH", "DELETE"],
        description: "HTTP method",
      },
      path: {
        type: "string",
        description: "API path scoped to the ADO organization",
      },
      body: {
        type: "object",
        description: "Optional JSON body for POST/PATCH requests",
      },
      wiql: {
        type: "string",
        description: "WIQL query (alternative to method/path)",
      },
    },
  },
};
