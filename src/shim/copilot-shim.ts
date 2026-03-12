#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Copilot Protocol Shim
// Speaks the Codex app-server JSON-RPC protocol on stdin/stdout, but
// forwards prompts to an OpenAI-compatible Chat Completions API.
//
// Works with:
//   - GitHub Copilot Chat Completions API
//   - Azure OpenAI
//   - OpenAI API directly
//   - Any OpenAI-compatible endpoint (e.g. Ollama, LM Studio)
//
// Config via environment variables:
//   COPILOT_API_BASE   — API base URL (default: https://api.githubcopilot.com)
//   COPILOT_API_KEY    — Bearer token / API key
//   COPILOT_MODEL      — Model name (default: gpt-4o)
//   COPILOT_MAX_TOKENS — Max response tokens (default: 16384)
//
// Usage in WORKFLOW.md:
//   codex:
//     command: node dist/shim/copilot-shim.js
// ---------------------------------------------------------------------------

import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE = (process.env.COPILOT_API_BASE ?? "https://api.githubcopilot.com").replace(/\/$/, "");
const API_KEY = process.env.COPILOT_API_KEY ?? "";
const MODEL = process.env.COPILOT_MODEL ?? "gpt-4o";
const MAX_TOKENS = parseInt(process.env.COPILOT_MAX_TOKENS ?? "16384", 10);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let threadId: string | null = null;
let turnId: string | null = null;
let cwd: string = process.cwd();
const conversationHistory: Array<{ role: string; content: string }> = [];
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalTokens = 0;

// ---------------------------------------------------------------------------
// stdio helpers
// ---------------------------------------------------------------------------

function sendMessage(msg: Record<string, unknown>): void {
  const line = JSON.stringify(msg);
  process.stdout.write(line + "\n");
}

function sendResponse(id: number, result: Record<string, unknown>): void {
  sendMessage({ id, result });
}

function sendErrorResponse(id: number, code: number, message: string): void {
  sendMessage({ id, error: { code, message } });
}

function sendNotification(method: string, params: Record<string, unknown>): void {
  sendMessage({ method, params });
}

function log(msg: string): void {
  process.stderr.write(`[copilot-shim] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Tool definitions for the model
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the given content. Path is relative to the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path within the workspace" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the contents of a file. Path is relative to the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path within the workspace" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace directory. Returns stdout and stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List files and directories at a given path relative to the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path (default: '.')" },
        },
        required: [],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

function executeTool(name: string, args: Record<string, unknown>): string {
  const wsPath = cwd;

  switch (name) {
    case "write_file": {
      const relPath = String(args.path ?? "");
      const content = String(args.content ?? "");
      if (!relPath) return JSON.stringify({ error: "path is required" });
      const absPath = resolve(wsPath, relPath);
      // Safety: must be under workspace
      if (!absPath.startsWith(resolve(wsPath))) {
        return JSON.stringify({ error: "path must be within workspace" });
      }
      const dir = dirname(absPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(absPath, content, "utf-8");
      return JSON.stringify({ ok: true, path: relPath });
    }

    case "read_file": {
      const relPath = String(args.path ?? "");
      if (!relPath) return JSON.stringify({ error: "path is required" });
      const absPath = resolve(wsPath, relPath);
      if (!absPath.startsWith(resolve(wsPath))) {
        return JSON.stringify({ error: "path must be within workspace" });
      }
      if (!existsSync(absPath)) {
        return JSON.stringify({ error: `file not found: ${relPath}` });
      }
      const content = readFileSync(absPath, "utf-8");
      // Truncate very large files
      const maxLen = 100_000;
      return content.length > maxLen ? content.slice(0, maxLen) + "\n...(truncated)" : content;
    }

    case "run_command": {
      const cmd = String(args.command ?? "");
      if (!cmd) return JSON.stringify({ error: "command is required" });
      try {
        const output = execSync(cmd, {
          cwd: wsPath,
          encoding: "utf-8",
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return output.slice(0, 50_000);
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return JSON.stringify({
          error: "command failed",
          stdout: (e.stdout ?? "").slice(0, 10_000),
          stderr: (e.stderr ?? "").slice(0, 10_000),
        });
      }
    }

    case "list_files": {
      const relPath = String(args.path ?? ".");
      const absPath = resolve(wsPath, relPath);
      if (!absPath.startsWith(resolve(wsPath))) {
        return JSON.stringify({ error: "path must be within workspace" });
      }
      try {
        const entries = readdirSync(absPath, { encoding: "utf-8" });
        const result = entries.map((e: string) => {
          try {
            const s = statSync(resolve(absPath, e));
            return s.isDirectory() ? `${e}/` : e;
          } catch {
            return e;
          }
        });
        return JSON.stringify(result);
      } catch {
        return JSON.stringify({ error: `cannot read directory: ${relPath}` });
      }
    }

    default:
      return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// Chat Completions API call with tool-use loop
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

async function chatCompletionFull(
  messages: ChatMessage[],
): Promise<{
  message: ChatMessage;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}> {
  const url = `${API_BASE}/chat/completions`;
  const body = {
    model: MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    tools: TOOLS,
    tool_choice: "auto",
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(API_BASE.includes("githubcopilot") ? { "Copilot-Integration-Id": "symphony-shim" } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text.slice(0, 500)}`);
  }

  const data = await resp.json() as {
    choices: Array<{
      message: ChatMessage;
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const choice = data.choices?.[0];
  if (!choice) throw new Error("No choices in API response");

  return {
    message: choice.message,
    usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Run a full agent turn: send prompt, handle tool calls in a loop, return final text.
 */
async function runAgentTurn(
  prompt: string,
): Promise<{ finalResponse: string; inputTokens: number; outputTokens: number }> {
  // Add user message to conversation
  conversationHistory.push({ role: "user", content: prompt });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
  ];

  let accInputTokens = 0;
  let accOutputTokens = 0;
  const maxToolRounds = 20;

  for (let round = 0; round < maxToolRounds; round++) {
    const fullResult = await chatCompletionFull(messages);
    accInputTokens += fullResult.usage.prompt_tokens;
    accOutputTokens += fullResult.usage.completion_tokens;

    const assistantMsg = fullResult.message;

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      // No tool calls — final response
      const text = assistantMsg.content ?? "";
      conversationHistory.push({ role: "assistant", content: text });
      return { finalResponse: text, inputTokens: accInputTokens, outputTokens: accOutputTokens };
    }

    // Add assistant message with tool calls to messages
    messages.push(assistantMsg);

    // Execute each tool call
    for (const tc of assistantMsg.tool_calls) {
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(tc.function.arguments);
      } catch {
        toolArgs = {};
      }

      log(`Tool call: ${tc.function.name}(${JSON.stringify(toolArgs).slice(0, 200)})`);

      // Notify Symphony about the tool execution
      sendNotification("item/notification", {
        message: `Executing: ${tc.function.name}`,
      });

      const toolResult = executeTool(tc.function.name, toolArgs);

      messages.push({
        role: "tool",
        content: toolResult,
        tool_call_id: tc.id,
      });
    }
  }

  // Exhausted tool rounds — send a final summarization
  const summary = "Reached maximum tool-use rounds. Work completed so far has been applied.";
  conversationHistory.push({ role: "assistant", content: summary });
  return { finalResponse: summary, inputTokens: accInputTokens, outputTokens: accOutputTokens };
}

function buildSystemPrompt(): string {
  return [
    "You are an expert software engineer working on a codebase.",
    `Your workspace directory is: ${cwd}`,
    "",
    "You have access to the following tools:",
    "- write_file: Create or overwrite files",
    "- read_file: Read file contents",
    "- run_command: Execute shell commands",
    "- list_files: List directory contents",
    "",
    "Guidelines:",
    "- Read existing files before modifying them to understand context.",
    "- Make targeted, minimal changes — don't rewrite entire files unless necessary.",
    "- Run tests after making changes if a test command is available.",
    "- If you need to create a branch, commit, or push, use run_command with git.",
    "- Explain what you did at the end of your response.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Protocol message handlers
// ---------------------------------------------------------------------------

async function handleMessage(msg: { id?: number; method?: string; params?: Record<string, unknown> }): Promise<void> {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize": {
      if (id == null) return;
      log("Received initialize");
      sendResponse(id, {
        serverInfo: { name: "copilot-shim", version: "1.0" },
        capabilities: {},
      });
      break;
    }

    case "initialized": {
      log("Received initialized notification");
      // No response for notifications
      break;
    }

    case "thread/start": {
      if (id == null) return;
      threadId = randomUUID();
      cwd = (params?.cwd as string) ?? process.cwd();
      log(`Thread started: ${threadId}, cwd: ${cwd}`);
      // Clear conversation history for a new thread
      conversationHistory.length = 0;
      sendResponse(id, {
        thread: { id: threadId },
      });
      break;
    }

    case "turn/start": {
      if (id == null) return;
      turnId = randomUUID();

      // Extract prompt from input
      const input = params?.input as Array<{ type: string; text: string }> | undefined;
      const prompt = input?.map((i) => i.text).join("\n") ?? "";
      const title = (params?.title as string) ?? "";

      log(`Turn started: ${turnId}${title ? ` — ${title}` : ""}`);

      // Respond immediately with turn ID
      sendResponse(id, {
        turn: { id: turnId },
      });

      // Now process the turn asynchronously
      try {
        const result = await runAgentTurn(prompt);

        // Update token totals
        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;
        totalTokens = totalInputTokens + totalOutputTokens;

        // Send token usage update
        sendNotification("thread/tokenUsage/updated", {
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens: totalTokens,
          },
        });

        // Send turn completed
        sendNotification("turn/completed", {
          turnId,
          result: {
            summary: result.finalResponse.slice(0, 500),
          },
        });

        log(`Turn completed: ${turnId} (tokens: ${totalTokens})`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log(`Turn failed: ${errMsg}`);

        sendNotification("turn/failed", {
          turnId,
          error: { message: errMsg },
        });
      }
      break;
    }

    default: {
      // Unknown method — respond with error if it has an id
      if (id != null) {
        sendErrorResponse(id, -32601, `Method not found: ${method}`);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main: read stdin line-delimited JSON
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!API_KEY) {
    log("WARNING: COPILOT_API_KEY is not set. API calls will fail.");
    log("Set one of: COPILOT_API_KEY, OPENAI_API_KEY, or GITHUB_TOKEN");
  }

  log(`Starting copilot-shim (model: ${MODEL}, api: ${API_BASE})`);

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let msg: { id?: number; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(line);
    } catch {
      log(`Malformed JSON: ${line.slice(0, 200)}`);
      continue;
    }

    // Handle each message — don't let errors crash the shim
    try {
      await handleMessage(msg);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`Error handling message: ${errMsg}`);
      if (msg.id != null) {
        sendErrorResponse(msg.id, -32603, errMsg);
      }
    }
  }

  log("stdin closed — exiting");
  process.exit(0);
}

main();
