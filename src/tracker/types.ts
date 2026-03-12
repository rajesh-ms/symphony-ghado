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
}
