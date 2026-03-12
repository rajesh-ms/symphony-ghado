#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Symphony CLI — Section 17.7
// Entry point: parse args, load workflow, start orchestrator.
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { loadWorkflow } from "./config/workflow-loader.js";
import { resolveConfig } from "./config/config.js";
import { validateDispatchConfig } from "./config/validation.js";
import { AdoClient } from "./tracker/ado-client.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { WorkflowWatcher } from "./config/watcher.js";
import { createLogger } from "./logging.js";

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  let workflowPath = resolve("WORKFLOW.md");
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith("--")) {
      workflowPath = resolve(args[i]);
    }
  }

  const logger = createLogger(process.stdout.isTTY ?? false);

  // Load workflow
  logger.info({ path: workflowPath }, "Loading workflow");
  const workflow = await loadWorkflow(workflowPath);
  let config = resolveConfig(workflow.config);
  let promptTemplate = workflow.prompt_template;
  config = { ...config, prompt_template: promptTemplate };

  // Resolve server port: CLI --port overrides server.port from config
  const serverPort = port ?? config.server?.port;

  // Create tracker client
  const tracker = new AdoClient(
    config.tracker.endpoint,
    config.tracker.api_key,
    config.tracker.project_slug,
  );

  // Create orchestrator
  const orchestrator = new Orchestrator({
    config,
    tracker,
    logger,
  });

  // Start workflow watcher
  const watcher = new WorkflowWatcher(workflowPath, {
    onReload: (newConfig, newPrompt) => {
      config = { ...newConfig, prompt_template: newPrompt };
      orchestrator.updateConfig(config);
      logger.info("Orchestrator config updated from workflow reload");
    },
    onError: (err) => {
      logger.error({ err }, "Workflow reload error — keeping last config");
    },
  }, logger);
  watcher.start();

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info("Shutting down");
    orchestrator.stop();
    watcher.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start HTTP server if port is configured
  if (serverPort != null) {
    const { startServer } = await import("./server/server.js");
    startServer(orchestrator, serverPort, logger);
  }

  // Start orchestrator
  await orchestrator.start();

  logger.info("Symphony started");
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
