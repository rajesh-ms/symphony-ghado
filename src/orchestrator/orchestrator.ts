// ---------------------------------------------------------------------------
// Orchestrator — Section 7–8
// Main scheduling engine: poll loop, dispatch, reconciliation, retry.
// ---------------------------------------------------------------------------

import type {
  Issue,
  OrchestratorState,
  RunningEntry,
  RetryEntry,
  ServiceConfig,
  CodexUpdateEvent,
} from "../types.js";
import { normalizeState, buildSessionId } from "../types.js";
import type { TrackerClient } from "../tracker/types.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { validateDispatchConfig } from "../config/validation.js";
import {
  createInitialState,
  isDispatchEligible,
  sortForDispatch,
  availableSlots,
  calculateBackoff,
  nextAttempt,
} from "./state.js";
import { runAgentAttempt } from "../agent/runner.js";
import type { Logger } from "pino";

export interface OrchestratorOptions {
  config: ServiceConfig;
  tracker: TrackerClient;
  logger: Logger;
  onStateChange?: () => void;
}

export class Orchestrator {
  private state: OrchestratorState;
  private config: ServiceConfig;
  private tracker: TrackerClient;
  private logger: Logger;
  private workspaceManager: WorkspaceManager;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private onStateChange: (() => void) | null;

  constructor(opts: OrchestratorOptions) {
    this.config = opts.config;
    this.tracker = opts.tracker;
    this.logger = opts.logger;
    this.onStateChange = opts.onStateChange ?? null;
    this.state = createInitialState(this.config);
    this.workspaceManager = new WorkspaceManager(
      this.config.workspace.root,
      this.config.hooks,
    );
  }

  /**
   * Start the orchestrator: validate config, run startup cleanup, begin polling.
   */
  async start(): Promise<void> {
    // Startup validation
    const validation = validateDispatchConfig(this.config);
    if (!validation.ok) {
      const errors = validation.errors.map((e) => e.message).join("; ");
      this.logger.error({ errors }, "Startup validation failed");
      throw new Error(`Startup validation failed: ${errors}`);
    }

    // Startup terminal workspace cleanup
    await this.startupTerminalCleanup();

    // Schedule immediate tick
    this.scheduleTick(0);
  }

  /**
   * Stop the orchestrator gracefully.
   */
  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Cancel all retry timers
    for (const [, entry] of this.state.retry_attempts) {
      if (entry.timer_handle) clearTimeout(entry.timer_handle);
    }
    this.state.retry_attempts.clear();
  }

  /**
   * Get a snapshot of current orchestrator state for observability.
   */
  getSnapshot(): OrchestratorSnapshot {
    const now = Date.now();
    let totalSeconds = this.state.codex_totals.seconds_running;

    const running: RunningSnapshot[] = [];
    for (const [id, entry] of this.state.running) {
      const elapsedMs = now - entry.started_at.getTime();
      totalSeconds += elapsedMs / 1000;
      running.push({
        issue_id: id,
        issue_identifier: entry.identifier,
        state: entry.issue.state,
        session_id: entry.session_id,
        turn_count: entry.turn_count,
        last_event: entry.last_codex_event,
        last_message: entry.last_codex_message,
        started_at: entry.started_at.toISOString(),
        last_event_at: entry.last_codex_timestamp?.toISOString() ?? null,
        tokens: {
          input_tokens: entry.codex_input_tokens,
          output_tokens: entry.codex_output_tokens,
          total_tokens: entry.codex_total_tokens,
        },
      });
    }

    const retrying: RetrySnapshot[] = [];
    for (const [, entry] of this.state.retry_attempts) {
      retrying.push({
        issue_id: entry.issue_id,
        issue_identifier: entry.identifier,
        attempt: entry.attempt,
        due_at: new Date(entry.due_at_ms).toISOString(),
        error: entry.error,
      });
    }

    return {
      generated_at: new Date().toISOString(),
      counts: {
        running: this.state.running.size,
        retrying: this.state.retry_attempts.size,
      },
      running,
      retrying,
      codex_totals: {
        ...this.state.codex_totals,
        seconds_running: totalSeconds,
      },
      rate_limits: this.state.codex_rate_limits,
    };
  }

  /**
   * Trigger an immediate poll cycle (for /api/v1/refresh).
   */
  async triggerRefresh(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    await this.tick();
  }

  /**
   * Update config after workflow reload.
   */
  updateConfig(config: ServiceConfig): void {
    this.config = config;
    this.state.poll_interval_ms = config.polling.interval_ms;
    this.state.max_concurrent_agents = config.agent.max_concurrent_agents;
    this.workspaceManager = new WorkspaceManager(
      config.workspace.root,
      config.hooks,
    );
  }

  /**
   * Find a running/retrying issue by identifier for the status API.
   */
  findIssueByIdentifier(identifier: string): IssueDetail | null {
    for (const [id, entry] of this.state.running) {
      if (entry.identifier === identifier) {
        return {
          issue_identifier: identifier,
          issue_id: id,
          status: "running",
          workspace: {
            path: this.workspaceManager
              ? `${this.config.workspace.root}/${entry.identifier}`
              : undefined,
          },
          running: {
            session_id: entry.session_id,
            turn_count: entry.turn_count,
            state: entry.issue.state,
            started_at: entry.started_at.toISOString(),
            last_event: entry.last_codex_event,
            last_message: entry.last_codex_message,
            last_event_at: entry.last_codex_timestamp?.toISOString() ?? null,
            tokens: {
              input_tokens: entry.codex_input_tokens,
              output_tokens: entry.codex_output_tokens,
              total_tokens: entry.codex_total_tokens,
            },
          },
          retry: null,
        };
      }
    }

    for (const [id, entry] of this.state.retry_attempts) {
      if (entry.identifier === identifier) {
        return {
          issue_identifier: identifier,
          issue_id: id,
          status: "retrying",
          workspace: {
            path: `${this.config.workspace.root}/${identifier}`,
          },
          running: null,
          retry: {
            attempt: entry.attempt,
            due_at: new Date(entry.due_at_ms).toISOString(),
            error: entry.error,
          },
        };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Private: tick loop
  // ---------------------------------------------------------------------------

  private scheduleTick(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;

    try {
      // 1. Reconcile running issues
      await this.reconcile();

      // 2. Dispatch preflight validation
      const validation = validateDispatchConfig(this.config);
      if (!validation.ok) {
        this.logger.warn(
          { errors: validation.errors.map((e) => e.message) },
          "Dispatch validation failed — skipping dispatch",
        );
        this.notifyStateChange();
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // 3. Fetch candidate issues
      let candidates: Issue[];
      try {
        candidates = await this.tracker.fetchCandidateIssues(this.config.tracker.active_states);
      } catch (err: unknown) {
        this.logger.error(
          { err },
          "Tracker candidate fetch failed — skipping dispatch",
        );
        this.notifyStateChange();
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // 4. Handle Epics: check children, auto-close if all terminal, skip dispatch
      const sorted = sortForDispatch(candidates);
      const actionable: Issue[] = [];
      for (const issue of sorted) {
        if (issue.work_item_type?.toLowerCase() === "epic") {
          await this.handleEpic(issue);
        } else {
          actionable.push(issue);
        }
      }

      for (const issue of actionable) {
        if (availableSlots(this.state) <= 0) break;
        if (isDispatchEligible(issue, this.state, this.config)) {
          this.dispatchIssue(issue, null);
        }
      }

      this.notifyStateChange();
    } catch (err: unknown) {
      this.logger.error({ err }, "Tick error");
    }

    this.scheduleTick(this.state.poll_interval_ms);
  }

  // ---------------------------------------------------------------------------
  // Private: reconciliation
  // ---------------------------------------------------------------------------

  private async reconcile(): Promise<void> {
    // Part A: Stall detection
    if (this.config.codex.stall_timeout_ms > 0) {
      const now = Date.now();
      for (const [id, entry] of this.state.running) {
        const lastTime =
          entry.last_codex_timestamp ?? entry.started_at;
        const elapsed = now - lastTime.getTime();
        if (elapsed > this.config.codex.stall_timeout_ms) {
          this.logger.warn(
            { issue_id: id, issue_identifier: entry.identifier, elapsed },
            "Stalled session detected — terminating",
          );
          this.terminateRunning(id, false);
          this.scheduleRetry(id, entry.identifier, nextAttempt(entry.retry_attempt), "stalled session");
        }
      }
    }

    // Part B: Tracker state refresh
    const runningIds = [...this.state.running.keys()];
    if (runningIds.length === 0) return;

    let refreshed: Issue[];
    try {
      refreshed = await this.tracker.fetchIssueStatesByIds(runningIds);
    } catch {
      this.logger.debug("State refresh failed — keeping workers running");
      return;
    }

    const refreshMap = new Map(refreshed.map((i) => [i.id, i]));
    const terminalStates = this.config.tracker.terminal_states.map(normalizeState);
    const activeStates = this.config.tracker.active_states.map(normalizeState);

    for (const [id, entry] of [...this.state.running]) {
      const issue = refreshMap.get(id);
      if (!issue) continue;

      const normState = normalizeState(issue.state);

      if (terminalStates.includes(normState)) {
        this.logger.info(
          { issue_id: id, issue_identifier: entry.identifier, state: issue.state },
          "Issue reached terminal state — stopping and cleaning workspace",
        );
        this.terminateRunning(id, true);
        this.cleanupWorkspace(entry.identifier);
      } else if (activeStates.includes(normState)) {
        // Update snapshot
        entry.issue = issue;
      } else {
        // Neither active nor terminal
        this.logger.info(
          { issue_id: id, issue_identifier: entry.identifier, state: issue.state },
          "Issue no longer active — stopping without cleanup",
        );
        this.terminateRunning(id, false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Epic auto-close
  // ---------------------------------------------------------------------------

  private async handleEpic(issue: Issue): Promise<void> {
    if (!this.tracker.fetchChildIds || !this.tracker.transitionIssue) {
      this.logger.debug(
        { issue_id: issue.id },
        "Tracker does not support child/transition — skipping Epic",
      );
      return;
    }

    try {
      const childIds = await this.tracker.fetchChildIds(issue.id);
      if (childIds.length === 0) {
        this.logger.info(
          { issue_id: issue.id, issue_identifier: issue.identifier },
          "Epic has no children — skipping",
        );
        return;
      }

      const children = await this.tracker.fetchIssueStatesByIds(childIds);
      const terminalStates = this.config.tracker.terminal_states.map(normalizeState);

      const allTerminal = children.every((c) =>
        terminalStates.includes(normalizeState(c.state)),
      );

      if (allTerminal) {
        this.logger.info(
          { issue_id: issue.id, issue_identifier: issue.identifier, child_count: childIds.length },
          "All Epic children are terminal — closing Epic",
        );
        await this.tracker.transitionIssue(issue.id, "Done");
      } else {
        const openChildren = children
          .filter((c) => !terminalStates.includes(normalizeState(c.state)))
          .map((c) => `${c.identifier}(${c.state})`);
        this.logger.debug(
          { issue_id: issue.id, open_children: openChildren },
          "Epic has open children — skipping",
        );
      }
    } catch (err: unknown) {
      this.logger.warn(
        { issue_id: issue.id, err },
        "Failed to handle Epic children check",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: dispatch
  // ---------------------------------------------------------------------------

  private dispatchIssue(issue: Issue, attempt: number | null): void {
    this.state.claimed.add(issue.id);

    // Remove from retry queue if present
    const existing = this.state.retry_attempts.get(issue.id);
    if (existing?.timer_handle) clearTimeout(existing.timer_handle);
    this.state.retry_attempts.delete(issue.id);

    const entry: RunningEntry = {
      identifier: issue.identifier,
      issue,
      session_id: null,
      thread_id: null,
      turn_id: null,
      codex_app_server_pid: null,
      last_codex_message: null,
      last_codex_event: null,
      last_codex_timestamp: null,
      codex_input_tokens: 0,
      codex_output_tokens: 0,
      codex_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      retry_attempt: attempt,
      started_at: new Date(),
      turn_count: 0,
    };

    this.state.running.set(issue.id, entry);

    this.logger.info(
      {
        issue_id: issue.id,
        issue_identifier: issue.identifier,
        attempt,
      },
      "Dispatching issue",
    );

    // Assign issue to the authenticated user (fire and forget)
    if (this.tracker.assignIssue) {
      this.tracker.assignIssue(issue.id).catch((err: unknown) => {
        this.logger.warn(
          { issue_id: issue.id, issue_identifier: issue.identifier, err },
          "Failed to assign issue to current user",
        );
      });
    }

    // Spawn worker (async — fire and forget with callback)
    this.runWorker(issue, attempt, entry);
  }

  private async runWorker(
    issue: Issue,
    attempt: number | null,
    entry: RunningEntry,
  ): Promise<void> {
    const onUpdate = (event: CodexUpdateEvent): void => {
      this.handleCodexUpdate(issue.id, event);
    };

    const fetchState = async (issueId: string): Promise<Issue | null> => {
      try {
        const results = await this.tracker.fetchIssueStatesByIds([issueId]);
        return results[0] ?? null;
      } catch {
        return null;
      }
    };

    try {
      const result = await runAgentAttempt(
        issue,
        attempt,
        this.config,
        this.workspaceManager,
        onUpdate,
        fetchState,
      );

      // Worker completed
      this.onWorkerExit(issue.id, result.ok, result.turnCount, result.error);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onWorkerExit(issue.id, false, 0, msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: worker exit and retry
  // ---------------------------------------------------------------------------

  private onWorkerExit(
    issueId: string,
    ok: boolean,
    turnCount: number,
    error?: string,
  ): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    // Accumulate runtime
    const elapsed = (Date.now() - entry.started_at.getTime()) / 1000;
    this.state.codex_totals.seconds_running += elapsed;

    this.state.running.delete(issueId);

    if (ok) {
      this.state.completed.add(issueId);
      // Schedule continuation retry (short delay)
      this.scheduleRetry(issueId, entry.identifier, 1, undefined);
      this.logger.info(
        { issue_id: issueId, issue_identifier: entry.identifier, turnCount },
        "Worker completed normally — scheduling continuation",
      );
    } else {
      const nextAtt = nextAttempt(entry.retry_attempt);
      this.scheduleRetry(issueId, entry.identifier, nextAtt, error);
      this.logger.warn(
        { issue_id: issueId, issue_identifier: entry.identifier, error, attempt: nextAtt },
        "Worker failed — scheduling retry",
      );
    }

    this.notifyStateChange();
  }

  private scheduleRetry(
    issueId: string,
    identifier: string,
    attempt: number,
    error: string | undefined,
  ): void {
    // Cancel existing timer
    const existing = this.state.retry_attempts.get(issueId);
    if (existing?.timer_handle) clearTimeout(existing.timer_handle);

    const isContinuation = error === undefined;
    const delay = calculateBackoff(
      attempt,
      isContinuation,
      this.config.agent.max_retry_backoff_ms,
    );
    const dueAt = Date.now() + delay;

    const timer = setTimeout(() => this.onRetryTimer(issueId), delay);

    this.state.retry_attempts.set(issueId, {
      issue_id: issueId,
      identifier,
      attempt,
      due_at_ms: dueAt,
      timer_handle: timer,
      error: error ?? null,
    });
  }

  private async onRetryTimer(issueId: string): Promise<void> {
    const retryEntry = this.state.retry_attempts.get(issueId);
    if (!retryEntry) return;
    this.state.retry_attempts.delete(issueId);

    // Fetch active candidates
    let candidates: Issue[];
    try {
      candidates = await this.tracker.fetchCandidateIssues(this.config.tracker.active_states);
    } catch {
      // Retry the retry
      this.scheduleRetry(
        issueId,
        retryEntry.identifier,
        retryEntry.attempt + 1,
        "retry poll failed",
      );
      return;
    }

    const issue = candidates.find((i) => i.id === issueId);
    if (!issue) {
      // Issue no longer among candidates — release claim
      this.state.claimed.delete(issueId);
      this.logger.info(
        { issue_id: issueId, issue_identifier: retryEntry.identifier },
        "Issue no longer a candidate — releasing claim",
      );
      this.notifyStateChange();
      return;
    }

    if (availableSlots(this.state) <= 0) {
      this.scheduleRetry(
        issueId,
        issue.identifier,
        retryEntry.attempt + 1,
        "no available orchestrator slots",
      );
      return;
    }

    this.dispatchIssue(issue, retryEntry.attempt);
  }

  // ---------------------------------------------------------------------------
  // Private: codex update handling
  // ---------------------------------------------------------------------------

  private handleCodexUpdate(issueId: string, event: CodexUpdateEvent): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    entry.last_codex_event = event.event;
    entry.last_codex_timestamp = event.timestamp;
    entry.last_codex_message = event.message ?? null;

    if (event.codex_app_server_pid) {
      entry.codex_app_server_pid = event.codex_app_server_pid;
    }

    // Section 4.1.6: turn_count tracks turns started within the current worker
    // lifetime. session_started fires on each turn/start response in the worker.
    if (event.event === "session_started") {
      entry.turn_count++;
    }

    // Token accounting: prefer absolute totals, track deltas
    if (event.usage) {
      const u = event.usage;
      if (event.event === "token_usage_updated") {
        // Absolute totals — compute delta from last reported
        const inTok = u.input_tokens ?? 0;
        const outTok = u.output_tokens ?? 0;
        const totTok = u.total_tokens ?? 0;
        const deltaIn = inTok - entry.last_reported_input_tokens;
        const deltaOut = outTok - entry.last_reported_output_tokens;
        const deltaTot = totTok - entry.last_reported_total_tokens;

        if (deltaIn > 0) {
          entry.codex_input_tokens += deltaIn;
          this.state.codex_totals.input_tokens += deltaIn;
        }
        if (deltaOut > 0) {
          entry.codex_output_tokens += deltaOut;
          this.state.codex_totals.output_tokens += deltaOut;
        }
        if (deltaTot > 0) {
          entry.codex_total_tokens += deltaTot;
          this.state.codex_totals.total_tokens += deltaTot;
        }

        entry.last_reported_input_tokens = inTok;
        entry.last_reported_output_tokens = outTok;
        entry.last_reported_total_tokens = totTok;
      }
    }

    // Rate-limit tracking
    if (event.payload?.rate_limits) {
      this.state.codex_rate_limits = event.payload.rate_limits as Record<string, unknown>;
    }

    this.notifyStateChange();
  }

  // ---------------------------------------------------------------------------
  // Private: workspace cleanup
  // ---------------------------------------------------------------------------

  private terminateRunning(issueId: string, addRuntime: boolean): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    if (addRuntime) {
      const elapsed = (Date.now() - entry.started_at.getTime()) / 1000;
      this.state.codex_totals.seconds_running += elapsed;
    }

    this.state.running.delete(issueId);
    this.state.claimed.delete(issueId);
  }

  private async cleanupWorkspace(identifier: string): Promise<void> {
    try {
      await this.workspaceManager.removeWorkspace(identifier);
    } catch (err: unknown) {
      this.logger.warn(
        { identifier, err },
        "Failed to cleanup workspace",
      );
    }
  }

  private async startupTerminalCleanup(): Promise<void> {
    try {
      const terminalIssues = await this.tracker.fetchIssuesByStates(
        this.config.tracker.terminal_states,
      );
      for (const issue of terminalIssues) {
        await this.cleanupWorkspace(issue.identifier);
      }
      this.logger.info(
        { count: terminalIssues.length },
        "Startup terminal workspace cleanup complete",
      );
    } catch (err: unknown) {
      this.logger.warn({ err }, "Startup terminal cleanup failed — continuing");
    }
  }

  private notifyStateChange(): void {
    this.onStateChange?.();
  }
}

// ---------------------------------------------------------------------------
// Snapshot types for observability
// ---------------------------------------------------------------------------

export interface OrchestratorSnapshot {
  generated_at: string;
  counts: { running: number; retrying: number };
  running: RunningSnapshot[];
  retrying: RetrySnapshot[];
  codex_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    seconds_running: number;
  };
  rate_limits: unknown;
}

export interface RunningSnapshot {
  issue_id: string;
  issue_identifier: string;
  state: string;
  session_id: string | null;
  turn_count: number;
  last_event: string | null;
  last_message: string | null;
  started_at: string;
  last_event_at: string | null;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface RetrySnapshot {
  issue_id: string;
  issue_identifier: string;
  attempt: number;
  due_at: string;
  error: string | null;
}

export interface IssueDetail {
  issue_identifier: string;
  issue_id: string;
  status: "running" | "retrying";
  workspace: { path?: string };
  running: {
    session_id: string | null;
    turn_count: number;
    state: string;
    started_at: string;
    last_event: string | null;
    last_message: string | null;
    last_event_at: string | null;
    tokens: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
  } | null;
  retry: {
    attempt: number;
    due_at: string;
    error: string | null;
  } | null;
}
