// ---------------------------------------------------------------------------
// Tracker Adapter Interface
// ---------------------------------------------------------------------------

import type { Issue } from "../types.js";

export interface TrackerClient {
  /** Fetch candidate issues in active states for dispatch. */
  fetchCandidateIssues(activeStates: string[]): Promise<Issue[]>;

  /** Fetch current state for specific issue IDs (for reconciliation). */
  fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>;

  /** Fetch issues in given states (used for startup terminal cleanup). */
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;

  /** Assign the issue to the currently authenticated user (optional). */
  assignIssue?(issueId: string): Promise<void>;

  /** Fetch child work item IDs for a parent (e.g. Epic). Returns empty array if none or unsupported. */
  fetchChildIds?(issueId: string): Promise<string[]>;

  /** Transition a work item to a new state (e.g. closing an Epic). */
  transitionIssue?(issueId: string, newState: string): Promise<void>;
}
