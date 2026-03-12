// ---------------------------------------------------------------------------
// Orchestrator State Helpers — Section 7
// Pure functions for state transitions, dispatch eligibility, and sorting.
// ---------------------------------------------------------------------------

import type {
  Issue,
  OrchestratorState,
  RunningEntry,
  RetryEntry,
  CodexTotals,
  ServiceConfig,
} from "../types.js";
import { normalizeState } from "../types.js";

/**
 * Create initial orchestrator state from config.
 */
export function createInitialState(config: ServiceConfig): OrchestratorState {
  return {
    poll_interval_ms: config.polling.interval_ms,
    max_concurrent_agents: config.agent.max_concurrent_agents,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    codex_totals: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      seconds_running: 0,
    },
    codex_rate_limits: null,
  };
}

/**
 * Check whether an issue is eligible for dispatch.
 */
export function isDispatchEligible(
  issue: Issue,
  state: OrchestratorState,
  config: ServiceConfig,
): boolean {
  // Must have required fields
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }

  const normState = normalizeState(issue.state);
  const activeStates = config.tracker.active_states.map(normalizeState);
  const terminalStates = config.tracker.terminal_states.map(normalizeState);

  // Must be active, not terminal
  if (!activeStates.includes(normState)) return false;
  if (terminalStates.includes(normState)) return false;

  // Must not be already running or claimed
  if (state.running.has(issue.id)) return false;
  if (state.claimed.has(issue.id)) return false;

  // Global concurrency
  if (state.running.size >= state.max_concurrent_agents) return false;

  // Per-state concurrency
  const byState = config.agent.max_concurrent_agents_by_state;
  const stateLimit = byState.get(normState);
  if (stateLimit != null) {
    const countInState = countRunningByState(state, normState);
    if (countInState >= stateLimit) return false;
  }

  // Blocker rule for "New": don't dispatch if any blocker is non-terminal
  if (normState === "new" && issue.blocked_by.length > 0) {
    const hasActiveBlocker = issue.blocked_by.some((b) => {
      if (!b.state) return true; // Unknown state = assume blocking
      return !terminalStates.includes(normalizeState(b.state));
    });
    if (hasActiveBlocker) return false;
  }

  return true;
}

/**
 * Sort issues for dispatch priority.
 * 1. priority ascending (null sorts last)
 * 2. created_at oldest first
 * 3. identifier lexicographic
 */
export function sortForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    // Priority: lower is higher priority, null sorts last
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;

    // Created at: oldest first
    const ca = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    const cb = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;

    // Identifier: lexicographic tie-breaker
    return a.identifier.localeCompare(b.identifier);
  });
}

/**
 * Compute available global dispatch slots.
 */
export function availableSlots(state: OrchestratorState): number {
  return Math.max(state.max_concurrent_agents - state.running.size, 0);
}

/**
 * Count running issues by normalized state.
 */
function countRunningByState(
  state: OrchestratorState,
  normState: string,
): number {
  let count = 0;
  for (const entry of state.running.values()) {
    if (normalizeState(entry.issue.state) === normState) count++;
  }
  return count;
}

/**
 * Calculate exponential backoff delay.
 * Normal continuation: 1000ms fixed.
 * Failure: min(10000 * 2^(attempt-1), maxBackoff).
 */
export function calculateBackoff(
  attempt: number,
  isContinuation: boolean,
  maxBackoffMs: number,
): number {
  if (isContinuation) return 1000;
  const delay = 10000 * Math.pow(2, attempt - 1);
  return Math.min(delay, maxBackoffMs);
}

/**
 * Compute the next attempt number.
 */
export function nextAttempt(current: number | null): number {
  return current == null ? 1 : current + 1;
}
