// ---------------------------------------------------------------------------
// Codex App-Server Client — Section 10
// Manages a single codex app-server subprocess over stdio.
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  ProtocolRequest,
  ProtocolResponse,
  CodexEvent,
} from "./protocol.js";
import { classifyMessage, extractUsage, extractRateLimits } from "./events.js";
import type { CodexConfig, TrackerConfig } from "../types.js";
import { executeAdoTool, adoApiToolSpec } from "./tools/ado-api.js";

const MAX_LINE_SIZE = 10 * 1024 * 1024; // 10 MB

export class AppServerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppServerError";
  }
}

export interface AppServerSession {
  threadId: string;
  turnId: string;
  sessionId: string;
  process: ChildProcess;
}

export type EventCallback = (event: CodexEvent) => void;

/**
 * Codex App-Server client. Manages subprocess lifecycle and JSON-RPC protocol.
 */
export class AppServerClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (v: ProtocolResponse) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private threadId: string | null = null;
  private turnId: string | null = null;
  private onEvent: EventCallback | null = null;
  private lineBuffer: string[] = [];

  private readonly isWsl: boolean;
  private trackerConfig: TrackerConfig | null = null;

  constructor(private readonly config: CodexConfig) {
    this.isWsl = process.platform === "win32" && /^wsl\s/i.test(config.command);
  }

  /**
   * Set tracker config for ado_api tool support.
   */
  setTrackerConfig(tracker: TrackerConfig): void {
    this.trackerConfig = tracker;
  }

  get pid(): string | undefined {
    return this.process?.pid?.toString();
  }

  /**
   * Convert a Windows path to a WSL /mnt/ path when running via WSL.
   */
  private resolveCwd(cwd: string): string {
    if (!this.isWsl) return cwd;
    // Convert C:\Users\... → /mnt/c/Users/...
    const match = cwd.match(/^([A-Za-z]):[/\\](.*)/);
    if (match) {
      const drive = match[1].toLowerCase();
      const rest = match[2].replace(/\\/g, "/");
      return `/mnt/${drive}/${rest}`;
    }
    return cwd.replace(/\\/g, "/");
  }

  /**
   * Launch the app-server subprocess in the given workspace directory.
   */
  launch(cwd: string): void {
    const isWindows = process.platform === "win32";
    const command = this.config.command;

    // If the command starts with "wsl" on Windows, spawn wsl directly
    // to avoid cmd.exe quote-mangling issues with nested shells.
    // Pass everything after "wsl " as arguments to wsl.exe.
    if (isWindows && /^wsl\s/i.test(command)) {
      // Split carefully: "wsl bash -c '...'" → ["wsl", "bash", "-c", "'...'"]
      // Use wsl's -- separator to pass the remainder as a shell command.
      const rest = command.slice(4).trim(); // everything after "wsl "
      this.process = spawn("wsl", ["--", "bash", "-c", rest], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } else {
      const shell = isWindows ? "cmd.exe" : "bash";
      const args = isWindows
        ? ["/c", command]
        : ["-lc", command];

      this.process = spawn(shell, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    }

    // Read protocol messages from stdout (line-delimited JSON)
    const rl = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      if (line.length > MAX_LINE_SIZE) return;
      this.handleLine(line);
    });

    // Stderr: log diagnostics, don't parse as protocol
    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        process.stderr.write(`[codex-stderr] ${text}\n`);
      }
    });

    this.process.on("error", (err) => {
      this.rejectAllPending(
        new AppServerError("port_exit", `Process error: ${err.message}`),
      );
    });

    this.process.on("close", () => {
      this.rejectAllPending(
        new AppServerError("port_exit", "App-server process exited"),
      );
    });
  }

  /**
   * Perform the startup handshake: initialize → initialized → thread/start.
   * Returns the thread ID.
   */
  async startThread(
    cwd: string,
    onEvent: EventCallback,
  ): Promise<string> {
    this.onEvent = onEvent;

    // 1. initialize request — declare experimentalApi for dynamic tools
    const initResp = await this.sendRequest("initialize", {
      clientInfo: { name: "symphony", version: "1.0" },
      capabilities: { experimentalApi: true },
    });
    if (initResp.error) {
      throw new AppServerError(
        "response_error",
        `initialize failed: ${initResp.error.message}`,
      );
    }

    // 2. initialized notification
    this.sendNotification("initialized", {});

    // 3. thread/start — advertise ado_api tool if tracker is configured
    const threadParams: Record<string, unknown> = {
      approvalPolicy: this.config.approval_policy,
      sandbox: this.config.thread_sandbox,
      cwd: this.resolveCwd(cwd),
    };
    if (this.trackerConfig?.kind === "ado" && this.trackerConfig.api_key) {
      threadParams.dynamicTools = [{
        name: adoApiToolSpec.name,
        description: adoApiToolSpec.description,
        inputSchema: adoApiToolSpec.parameters,
      }];
    }
    const threadResp = await this.sendRequest("thread/start", threadParams);
    if (threadResp.error) {
      throw new AppServerError(
        "response_error",
        `thread/start failed: ${threadResp.error.message}`,
      );
    }

    // Extract thread ID from nested result shapes
    const result = threadResp.result ?? {};
    const thread = result.thread as Record<string, unknown> | undefined;
    this.threadId = (thread?.id ?? result.threadId ?? result.id) as string;

    if (!this.threadId) {
      throw new AppServerError(
        "response_error",
        "thread/start did not return a thread ID",
      );
    }

    return this.threadId;
  }

  /**
   * Start a turn on the current thread and stream events until completion.
   * Returns the turn result event type.
   */
  async runTurn(
    prompt: string,
    issueIdentifier: string,
    issueTitle: string,
    cwd: string,
    onEvent: EventCallback,
  ): Promise<"turn_completed" | "turn_failed" | "turn_cancelled"> {
    if (!this.threadId) {
      throw new AppServerError(
        "invalid_workspace_cwd",
        "No thread started",
      );
    }

    this.onEvent = onEvent;

    const turnResp = await this.sendRequest("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
      cwd: this.resolveCwd(cwd),
      title: `${issueIdentifier}: ${issueTitle}`,
      approvalPolicy: this.config.approval_policy,
      sandboxPolicy: { type: this.config.turn_sandbox_policy },
    });

    if (turnResp.error) {
      throw new AppServerError(
        "response_error",
        `turn/start failed: ${turnResp.error.message}`,
      );
    }

    // Extract turn ID
    const result = turnResp.result ?? {};
    const turn = result.turn as Record<string, unknown> | undefined;
    this.turnId = (turn?.id ?? result.turnId ?? result.id) as string;

    const sessionId = this.threadId && this.turnId
      ? `${this.threadId}-${this.turnId}`
      : "unknown";

    // Emit turn_started so orchestrator can track turn_count.
    // Per Section 4.1.6: turn_count = "number of coding-agent turns started
    // within the current worker lifetime." This fires on each turn/start response.
    onEvent({
      event: "session_started",
      timestamp: new Date(),
      codex_app_server_pid: this.pid,
      message: `Turn started: session ${sessionId}`,
    });

    // Stream turn messages until completion
    return this.streamUntilTurnEnd(onEvent);
  }

  /**
   * Stop the app-server subprocess.
   */
  stop(): void {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 2000);
    }
    this.process = null;
    this.threadId = null;
    this.turnId = null;
    this.onEvent = null;
  }

  get sessionId(): string | null {
    if (!this.threadId || !this.turnId) return null;
    return `${this.threadId}-${this.turnId}`;
  }

  get currentThreadId(): string | null {
    return this.threadId;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private handleLine(line: string): void {
    let msg: ProtocolResponse;
    try {
      msg = JSON.parse(line) as ProtocolResponse;
    } catch {
      // Not valid JSON — malformed
      this.onEvent?.({
        event: "malformed",
        timestamp: new Date(),
        codex_app_server_pid: this.pid,
        message: line.slice(0, 200),
      });
      return;
    }

    // Handle pending request responses
    if (msg.id != null && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);
      pending.resolve(msg);
      return;
    }

    // Handle streaming messages
    const event = classifyMessage(msg, this.pid);

    // Auto-approve approval requests (high-trust per spec 10.5)
    if (event.event === "approval_auto_approved") {
      this.sendApprovalResponse(msg);
    }

    // Handle tool calls
    if (event.event === "unsupported_tool_call") {
      const params = msg.params as Record<string, unknown> | undefined;
      const toolName = (params?.tool ?? params?.name ?? params?.toolName) as string | undefined;
      process.stderr.write(`[symphony] Tool call received: tool=${toolName} callId=${params?.callId} method=${msg.method}\n`);
      if (toolName === "ado_api" && this.trackerConfig) {
        this.handleAdoToolCall(msg);
      } else {
        this.sendToolFailureResponse(msg);
      }
    }

    // Extract rate limits if present
    const rateLimits = extractRateLimits(msg);
    if (rateLimits) {
      event.payload = { ...event.payload, rate_limits: rateLimits };
    }

    this.onEvent?.(event);

    // Store turn-ending events for streamUntilTurnEnd
    const turnEndEvents = [
      "turn_completed",
      "turn_failed",
      "turn_cancelled",
      "turn_input_required",
    ];
    if (turnEndEvents.includes(event.event)) {
      this.lineBuffer.push(event.event);
    }
  }

  private sendApprovalResponse(msg: ProtocolResponse): void {
    const approvalId =
      (msg.params as Record<string, unknown>)?.id ?? msg.id;
    if (approvalId != null) {
      this.write({
        id: approvalId as number,
        result: { approved: true },
      });
    }
  }

  private sendToolFailureResponse(msg: ProtocolResponse): void {
    const params = msg.params as Record<string, unknown> | undefined;
    const toolId = params?.callId ?? params?.id ?? msg.id;
    if (toolId != null) {
      this.write({
        id: toolId as number,
        result: {
          success: false,
          contentItems: [{ type: "inputText", text: JSON.stringify({ error: "unsupported_tool_call" }) }],
        },
      });
    }
  }

  private handleAdoToolCall(msg: ProtocolResponse): void {
    const params = msg.params as Record<string, unknown> | undefined;
    const toolId = params?.callId ?? params?.id ?? msg.id;
    const input = (params?.arguments ?? params?.input ?? {}) as Record<string, unknown>;

    process.stderr.write(`[symphony] ADO tool call: toolId=${toolId} input=${JSON.stringify(input).slice(0, 500)}\n`);

    if (!this.trackerConfig) {
      if (toolId != null) {
        this.write({ id: toolId as number, result: {
          success: false,
          contentItems: [{ type: "inputText", text: JSON.stringify({ error: "tracker not configured" }) }],
        }});
      }
      return;
    }

    // Execute async, respond when done
    executeAdoTool(input, this.trackerConfig).then((result) => {
      if (toolId != null) {
        this.write({ id: toolId as number, result: {
          success: result.success,
          contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
        }});
      }
    }).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (toolId != null) {
        this.write({ id: toolId as number, result: {
          success: false,
          contentItems: [{ type: "inputText", text: JSON.stringify({ error: errMsg }) }],
        }});
      }
    });
  }

  private streamUntilTurnEnd(
    onEvent: EventCallback,
  ): Promise<"turn_completed" | "turn_failed" | "turn_cancelled"> {
    return new Promise((resolve, reject) => {
      const turnTimeout = setTimeout(() => {
        onEvent({
          event: "turn_failed",
          timestamp: new Date(),
          codex_app_server_pid: this.pid,
          message: "Turn timed out",
        });
        reject(new AppServerError("turn_timeout", "Turn timed out"));
      }, this.config.turn_timeout_ms);

      const checkInterval = setInterval(() => {
        while (this.lineBuffer.length > 0) {
          const evt = this.lineBuffer.shift()!;
          clearTimeout(turnTimeout);
          clearInterval(checkInterval);

          if (evt === "turn_input_required") {
            reject(
              new AppServerError(
                "turn_input_required",
                "Agent requested user input",
              ),
            );
            return;
          }

          resolve(evt as "turn_completed" | "turn_failed" | "turn_cancelled");
          return;
        }
      }, 50);

      // Also reject on process exit
      this.process?.on("close", () => {
        clearTimeout(turnTimeout);
        clearInterval(checkInterval);
        reject(new AppServerError("port_exit", "App-server process exited during turn"));
      });
    });
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<ProtocolResponse> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new AppServerError(
            "response_timeout",
            `Timeout waiting for response to ${method}`,
          ),
        );
      }, this.config.read_timeout_ms);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  private sendNotification(
    method: string,
    params: Record<string, unknown>,
  ): void {
    this.write({ method, params });
  }

  private write(msg: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingRequests.delete(id);
    }
  }
}
