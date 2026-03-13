import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";

import {
  AccessDeniedError,
  AgentRegistry,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "./agent-registry.js";
import { FileRegistryStore } from "./file-registry-store.js";
import type { AgentCardInput, HeartbeatInput, SearchFilters } from "./models.js";

export interface CreateServerOptions {
  dataFilePath?: string;
}

export function createServer(options: CreateServerOptions = {}) {
  const store = new FileRegistryStore(options.dataFilePath ?? resolve(process.cwd(), "data/registry.json"));
  const registry = new AgentRegistry({ store });

  const server = createHttpServer(async (request, response) => {
    try {
      await routeRequest(registry, request, response);
    } catch (error) {
      handleError(response, error);
    }
  });

  return { server, registry };
}

async function routeRequest(registry: AgentRegistry, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (method === "POST" && segments.length === 1 && segments[0] === "agents") {
    const payload = (await readJson(request)) as AgentCardInput;
    const created = registry.register(payload);
    sendJson(response, 201, created);
    return;
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "agents") {
    const filters = parseSearchFilters(url.searchParams);
    const result = registry.search(filters);
    sendJson(response, 200, result);
    return;
  }

  if (method === "GET" && segments.length === 2 && segments[0] === "agents") {
    const name = segments[1]!;
    const requester = url.searchParams.get("requester") ?? undefined;
    const version = url.searchParams.get("version");

    if (version) {
      sendJson(response, 200, registry.get(name, version, requester));
      return;
    }

    sendJson(response, 200, registry.getByName(name, requester));
    return;
  }

  if (method === "POST" && segments.length === 4 && segments[0] === "agents" && segments[3] === "heartbeat") {
    const name = segments[1]!;
    const version = segments[2]!;
    const payload = (await readJson(request, true)) as HeartbeatInput;
    const updated = registry.recordHeartbeat(name, version, payload ?? {});
    sendJson(response, 200, updated);
    return;
  }

  if (method === "GET" && segments.length === 2 && segments[0] === "resolve") {
    const name = segments[1]!;
    const requester = url.searchParams.get("requester") ?? undefined;
    const version = url.searchParams.get("version") ?? undefined;
    const action = url.searchParams.get("action") === "view" ? "view" : "invoke";
    const resolved = registry.resolve(name, {
      action,
      ...(requester ? { requester } : {}),
      ...(version ? { version } : {}),
    });
    sendJson(response, 200, resolved);
    return;
  }

  sendJson(response, 404, { error: "Route not found." });
}

function parseSearchFilters(searchParams: URLSearchParams): SearchFilters {
  const deprecatedParam = searchParams.get("deprecated");
  const pageParam = searchParams.get("page");
  const pageSizeParam = searchParams.get("pageSize");
  const tag = searchParams.get("tag");
  const capability = searchParams.get("capability");
  const useCase = searchParams.get("useCase");
  const owner = searchParams.get("owner");
  const status = searchParams.get("status");
  const requester = searchParams.get("requester");

  return {
    action: searchParams.get("action") === "invoke" ? "invoke" : "view",
    ...(tag ? { tag } : {}),
    ...(capability ? { capability } : {}),
    ...(useCase ? { useCase } : {}),
    ...(owner ? { owner } : {}),
    ...(status ? { status: status as NonNullable<SearchFilters["status"]> } : {}),
    ...(requester ? { requester } : {}),
    ...(deprecatedParam === null ? {} : { deprecated: deprecatedParam === "true" }),
    ...(pageParam ? { page: Number.parseInt(pageParam, 10) } : {}),
    ...(pageSizeParam ? { pageSize: Number.parseInt(pageSizeParam, 10) } : {}),
  };
}

async function readJson(request: IncomingMessage, allowEmpty = false): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    if (allowEmpty) {
      return undefined;
    }

    throw new ValidationError("Request body is required.");
  }

  const payload = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(payload);
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

function handleError(response: ServerResponse, error: unknown): void {
  if (
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof NotFoundError ||
    error instanceof AccessDeniedError
  ) {
    sendJson(response, error.statusCode, { error: error.message });
    return;
  }

  sendJson(response, 500, { error: "Internal server error." });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
