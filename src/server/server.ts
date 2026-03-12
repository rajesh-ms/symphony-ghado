// ---------------------------------------------------------------------------
// Optional HTTP Server — Section 13.7
// Observability dashboard and JSON REST API.
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Logger } from "pino";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import { getRegistryCatalog } from "../registry/catalog.js";
import { renderRegistryPage } from "./registry-page.js";

export function startServer(
  orchestrator: Orchestrator,
  port: number,
  logger: Logger,
): Server {
  const server = createApp(orchestrator, logger);

  const host = "0.0.0.0";
  server.listen(port, host, () => {
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;
    logger.info({ port: actualPort, host }, "HTTP server listening");
  });

  return server;
}

export function createApp(orchestrator: Orchestrator, logger: Logger): Server {
  return createServer((req, res) => {
    handleRequest(req, res, orchestrator, logger).catch((err) => {
      logger.error({ err }, "Unhandled server error");
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "internal_error", message: "Internal server error" } }));
      }
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  orchestrator: Orchestrator,
  logger: Logger,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route: GET / — Dashboard
  if (pathname === "/" && method === "GET") {
    const snapshot = orchestrator.getSnapshot();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderDashboard(snapshot));
    return;
  }

  // Route: GET /registry
  if (pathname === "/registry" && method === "GET") {
    const catalog = getRegistryCatalog();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderRegistryPage(catalog));
    return;
  }

  // Route: GET /api/v1/state
  if (pathname === "/api/v1/state" && method === "GET") {
    const snapshot = orchestrator.getSnapshot();
    sendJson(res, 200, snapshot);
    return;
  }

  // Route: GET /api/v1/registry
  if (pathname === "/api/v1/registry" && method === "GET") {
    sendJson(res, 200, getRegistryCatalog());
    return;
  }

  // Route: POST /api/v1/refresh
  if (pathname === "/api/v1/refresh" && method === "POST") {
    orchestrator.triggerRefresh().catch((err) => {
      logger.warn({ err }, "Refresh trigger error");
    });
    sendJson(res, 202, {
      queued: true,
      coalesced: false,
      requested_at: new Date().toISOString(),
      operations: ["poll", "reconcile"],
    });
    return;
  }

  // Route: GET /api/v1/:identifier — Issue detail
  if (pathname.startsWith("/api/v1/") && method === "GET") {
    const identifier = decodeURIComponent(pathname.slice("/api/v1/".length));
    if (identifier && identifier !== "state" && identifier !== "refresh") {
      const detail = orchestrator.findIssueByIdentifier(identifier);
      if (detail) {
        sendJson(res, 200, detail);
      } else {
        sendJson(res, 404, {
          error: { code: "issue_not_found", message: `Issue '${identifier}' not found in current state` },
        });
      }
      return;
    }
  }

  // Method not allowed on known routes
  if (pathname === "/api/v1/refresh" && method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
    res.end(JSON.stringify({ error: { code: "method_not_allowed", message: `${method} not allowed` } }));
    return;
  }

  // 404
  sendJson(res, 404, {
    error: { code: "not_found", message: `Route ${pathname} not found` },
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

// ---------------------------------------------------------------------------
// Minimal server-rendered dashboard
// ---------------------------------------------------------------------------

function renderDashboard(snapshot: ReturnType<Orchestrator["getSnapshot"]>): string {
  const running = snapshot.running
    .map(
      (r) => `<tr>
        <td>${esc(r.issue_identifier)}</td>
        <td>${esc(r.state)}</td>
        <td>${esc(r.session_id ?? "-")}</td>
        <td>${r.turn_count}</td>
        <td>${esc(r.last_event ?? "-")}</td>
        <td>${esc(r.started_at)}</td>
        <td>${r.tokens.total_tokens}</td>
      </tr>`,
    )
    .join("\n");

  const retrying = snapshot.retrying
    .map(
      (r) => `<tr>
        <td>${esc(r.issue_identifier)}</td>
        <td>${r.attempt}</td>
        <td>${esc(r.due_at)}</td>
        <td>${esc(r.error ?? "-")}</td>
      </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Symphony Dashboard</title>
  <meta http-equiv="refresh" content="10">
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #f8f9fa; color: #212529; }
    h1 { margin-bottom: 0.5rem; }
    .meta { color: #6c757d; margin-bottom: 1.5rem; font-size: 0.9rem; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; background: #fff; }
    th, td { padding: 0.5rem 0.75rem; text-align: left; border: 1px solid #dee2e6; }
    th { background: #e9ecef; font-weight: 600; }
    .totals { display: flex; gap: 2rem; margin-bottom: 1.5rem; }
    .totals div { background: #fff; padding: 1rem; border: 1px solid #dee2e6; border-radius: 4px; }
    .totals .label { font-size: 0.8rem; color: #6c757d; text-transform: uppercase; }
    .totals .value { font-size: 1.5rem; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Symphony</h1>
  <p class="meta">Generated at ${esc(snapshot.generated_at)}</p>
  <p class="meta"><a href="/registry">Open AI agent registry</a></p>

  <div class="totals">
    <div><div class="label">Running</div><div class="value">${snapshot.counts.running}</div></div>
    <div><div class="label">Retrying</div><div class="value">${snapshot.counts.retrying}</div></div>
    <div><div class="label">Total Tokens</div><div class="value">${snapshot.codex_totals.total_tokens}</div></div>
    <div><div class="label">Runtime</div><div class="value">${snapshot.codex_totals.seconds_running.toFixed(0)}s</div></div>
  </div>

  <h2>Running Sessions</h2>
  <table>
    <thead><tr><th>Issue</th><th>State</th><th>Session</th><th>Turns</th><th>Last Event</th><th>Started</th><th>Tokens</th></tr></thead>
    <tbody>${running || "<tr><td colspan=\"7\">No running sessions</td></tr>"}</tbody>
  </table>

  <h2>Retry Queue</h2>
  <table>
    <thead><tr><th>Issue</th><th>Attempt</th><th>Due At</th><th>Error</th></tr></thead>
    <tbody>${retrying || "<tr><td colspan=\"4\">No pending retries</td></tr>"}</tbody>
  </table>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
