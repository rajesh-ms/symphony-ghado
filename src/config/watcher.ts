// ---------------------------------------------------------------------------
// Workflow File Watcher — Section 6.2
// Watches WORKFLOW.md for changes and triggers reload/re-apply.
// ---------------------------------------------------------------------------

import { watch, type FSWatcher } from "chokidar";
import { loadWorkflow, WorkflowLoadError } from "../config/workflow-loader.js";
import { resolveConfig } from "../config/config.js";
import type { ServiceConfig, WorkflowDefinition } from "../types.js";
import type { Logger } from "pino";

export interface WorkflowWatcherCallbacks {
  onReload: (config: ServiceConfig, promptTemplate: string) => void;
  onError: (error: Error) => void;
}

export class WorkflowWatcher {
  private watcher: FSWatcher | null = null;
  private lastGoodConfig: ServiceConfig | null = null;

  constructor(
    private readonly workflowPath: string,
    private readonly callbacks: WorkflowWatcherCallbacks,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.watcher = watch(this.workflowPath, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on("change", () => this.handleChange());

    this.logger.info(
      { path: this.workflowPath },
      "Watching workflow file for changes",
    );
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private async handleChange(): Promise<void> {
    this.logger.info("Workflow file changed — reloading");

    try {
      const workflow = await loadWorkflow(this.workflowPath);
      const config = resolveConfig(workflow.config);

      this.lastGoodConfig = config;
      this.callbacks.onReload(config, workflow.prompt_template);

      this.logger.info("Workflow config reloaded successfully");
    } catch (err: unknown) {
      this.logger.error(
        { err },
        "Failed to reload workflow — keeping last known good config",
      );
      this.callbacks.onError(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}
