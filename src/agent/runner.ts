// ---------------------------------------------------------------------------
// Agent Runner — Section 10.7
// Worker lifecycle: workspace → prompt → app-server session → event relay.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Issue, ServiceConfig, CodexUpdateEvent } from "../types.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { renderPrompt } from "../prompt/renderer.js";
import { AppServerClient, AppServerError } from "./app-server-client.js";
import type { CodexEvent } from "./protocol.js";

const PROGRESS_FILE = "SYMPHONY_PROGRESS.md";

export interface RunnerResult {
  ok: boolean;
  turnCount: number;
  error?: string;
}

export type OrchestratorCallback = (event: CodexUpdateEvent) => void;

/**
 * Run a full agent attempt for one issue.
 * Handles workspace, prompt, multi-turn loop, and cleanup.
 */
export async function runAgentAttempt(
  issue: Issue,
  attempt: number | null,
  config: ServiceConfig,
  workspaceManager: WorkspaceManager,
  onUpdate: OrchestratorCallback,
  fetchIssueState: (issueId: string) => Promise<Issue | null>,
): Promise<RunnerResult> {
  // 1. Create/reuse workspace
  let workspace;
  try {
    workspace = await workspaceManager.createForIssue(issue.identifier);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, turnCount: 0, error: `workspace error: ${msg}` };
  }

  // 2. Before-run hook (Section 5.3.4: runs after workspace preparation,
  //    before launching the coding agent)
  try {
    await workspaceManager.runBeforeRunHook(workspace.path);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, turnCount: 0, error: `before_run hook error: ${msg}` };
  }

  // 2b. Read previous progress file (if any) for context handoff
  const previousProgress = await readProgressFile(workspace.path);

  // 3. Start app-server session (launched AFTER before_run per spec Section 5.3.4)
  const client = new AppServerClient(config.codex);
  client.setTrackerConfig(config.tracker);
  let turnCount = 0;

  try {
    client.launch(workspace.path);

    const eventRelay = (event: CodexEvent): void => {
      onUpdate({
        issue_id: issue.id,
        event: event.event,
        timestamp: event.timestamp,
        codex_app_server_pid: event.codex_app_server_pid,
        usage: event.usage,
        message: event.message,
        payload: event.payload,
      });
    };

    await client.startThread(workspace.path, eventRelay);

    // 4. Multi-turn loop
    const maxTurns = config.agent.max_turns;
    let currentIssue = issue;

    for (let turnNum = 1; turnNum <= maxTurns; turnNum++) {
      // Build prompt: full task prompt for first turn, continuation for subsequent
      let prompt: string;
      try {
        if (turnNum === 1) {
          prompt = await renderPrompt(
            config.prompt_template,
            currentIssue,
            attempt,
            previousProgress,
          );
        } else {
          prompt = buildContinuationPrompt(currentIssue, turnNum, maxTurns, previousProgress);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new AppServerError("response_error", `prompt error: ${msg}`);
      }

      // Run the turn
      const turnResult = await client.runTurn(
        prompt,
        currentIssue.identifier,
        currentIssue.title,
        workspace.path,
        eventRelay,
      );
      turnCount++;

      if (turnResult === "turn_failed" || turnResult === "turn_cancelled") {
        throw new AppServerError(
          "turn_failed",
          `Turn ${turnNum} ended with ${turnResult}`,
        );
      }

      // Check if we should continue
      if (turnNum >= maxTurns) break;

      // Re-check issue state from tracker
      const refreshed = await fetchIssueState(currentIssue.id);
      if (!refreshed) break;

      const activeStates = config.tracker.active_states.map((s) =>
        s.trim().toLowerCase(),
      );
      if (!activeStates.includes(refreshed.state.trim().toLowerCase())) {
        break;
      }

      currentIssue = refreshed;
    }

    await writeProgressFile(workspace.path, issue, attempt, turnCount, true);
    return { ok: true, turnCount };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeProgressFile(workspace.path, issue, attempt, turnCount, false, msg);
    return { ok: false, turnCount, error: `agent session error: ${msg}` };
  } finally {
    client.stop();
    await workspaceManager.runAfterRunHook(workspace.path);
  }
}

function buildContinuationPrompt(
  issue: Issue,
  turnNum: number,
  maxTurns: number,
  previousProgress: string | null,
): string {
  const lines = [
    `Continue working on ${issue.identifier}: ${issue.title}.`,
    `This is turn ${turnNum} of ${maxTurns}.`,
    `The issue is still in state "${issue.state}". Please continue where you left off.`,
  ];
  if (previousProgress) {
    lines.push("", "## Previous Progress", previousProgress);
  }
  return lines.join("\n");
}

/**
 * Read the progress file from a workspace, returning null if absent.
 */
async function readProgressFile(wsPath: string): Promise<string | null> {
  try {
    return await readFile(join(wsPath, PROGRESS_FILE), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Write a structured progress file summarizing the completed run.
 * Appends to existing progress so the full history is preserved.
 */
async function writeProgressFile(
  wsPath: string,
  issue: Issue,
  attempt: number | null,
  turnCount: number,
  ok: boolean,
  error?: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const existingContent = await readProgressFile(wsPath);

  const entry = [
    `### Run ${timestamp}`,
    `- **Issue**: ${issue.identifier} — ${issue.title}`,
    `- **Attempt**: ${attempt ?? "initial"}`,
    `- **Turns used**: ${turnCount}`,
    `- **Outcome**: ${ok ? "success" : "failure"}`,
    ...(error ? [`- **Error**: ${error}`] : []),
    `- **Issue state at end**: ${issue.state}`,
    "",
  ].join("\n");

  const content = existingContent
    ? `${existingContent.trimEnd()}\n\n${entry}`
    : `# Symphony Progress Log\n\nThis file tracks agent run history for context handoff between re-dispatches.\n\n${entry}`;

  try {
    await writeFile(join(wsPath, PROGRESS_FILE), content, "utf-8");
  } catch {
    // Non-fatal — best-effort progress tracking
  }
}
