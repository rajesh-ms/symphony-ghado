---
tracker:
  kind: ado
  endpoint: https://dev.azure.com/rajeshsingh0451
  api_key: $ADO_PAT
  project_slug: agent-marketplace
  active_states: [To Do, Doing]
  terminal_states: [Done, Closed, Removed]
polling:
  interval_ms: 15000
workspace:
  root: ./test_workspaces
hooks:
  after_create: |
    git init
    git remote add origin https://github.com/rajesh-ms/agent-marketplace.git
    git fetch origin main --depth=1 2>/dev/null || true
    BRANCH="issue-$(basename $(pwd))"
    git checkout -b "$BRANCH" origin/main 2>/dev/null || git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
    git config user.email "symphony@agent.local"
    git config user.name "Symphony Agent"
  before_run: |
    echo "Starting agent work on issue-$(basename $(pwd))"
  after_run: |
    git add -A
    if git diff --cached --quiet; then
      echo "No changes to commit"
    else
      BRANCH="issue-$(basename $(pwd))"
      git commit -m "Symphony agent: work on issue $(basename $(pwd))"
      git push -u origin "$BRANCH" --force
      echo "Pushed to branch $BRANCH"
    fi
agent:
  max_concurrent_agents: 2
  max_turns: 10
  max_retry_backoff_ms: 30000
codex:
  command: codex app-server
  approval_policy: never
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
server:
  port: 3000
---
You are a senior software engineer working on an AI Agent Marketplace project.
Your workspace is an empty directory — initialize it as a new project and build the requested feature.

## Current Task
Issue {{ issue.identifier }}: {{ issue.title }}

{% if issue.description %}
### Description
{{ issue.description }}
{% endif %}

{% if issue.labels.size > 0 %}
### Labels
{{ issue.labels | join: ", " }}
{% endif %}

{% if attempt %}
> This is retry attempt {{ attempt }}. Check what already exists in the workspace and continue from where the previous run left off.
{% endif %}

{% if previous_progress %}
### Previous Run Progress
The following is the progress log from prior agent runs on this issue. Use it to understand what was already done and what remains.

{{ previous_progress }}
{% endif %}

### Instructions
1. **Analyze** the issue requirements carefully.
2. **Create files** in your workspace directory to implement the solution:
   - Initialize a project structure (e.g. package.json, tsconfig.json)
   - Write the implementation code
   - Add basic tests
3. **Create project documentation**:
   - `README.md` — project overview, setup instructions, usage examples
   - `AGENTS.md` — navigation guide for AI agents: repo map, key files table, build/test commands, architecture summary, constraints
   - `docs/architecture.md` — system layers, data flow diagram, concurrency model, key invariants
   - `docs/decisions.md` — design decisions with rationale (why this approach, alternatives considered)
4. **Update the ADO work item** using the `ado_api` tool:
   - Add a comment describing what you built: use `ado_api` with `method: "PATCH"`, `path: "/agent-marketplace/_apis/wit/workitems/{{ issue.identifier }}?api-version=7.1"`, `body: [{"op": "add", "path": "/fields/System.History", "value": "<your summary>"}]`. Set Content-Type to `application/json-patch+json`.
   - Change the state to "Doing": use `ado_api` with `method: "PATCH"`, `path: "/agent-marketplace/_apis/wit/workitems/{{ issue.identifier }}?api-version=7.1"`, `body: [{"op": "replace", "path": "/fields/System.State", "value": "Doing"}]`. Set Content-Type to `application/json-patch+json`.
5. After completing implementation, change state to "Done":
   - Use `ado_api` with `method: "PATCH"`, `path: "/agent-marketplace/_apis/wit/workitems/{{ issue.identifier }}?api-version=7.1"`, `body: [{"op": "replace", "path": "/fields/System.State", "value": "Done"}]`

### Key Constraints
- Write real, working code — not stubs or placeholders
- Use TypeScript/Node.js for the implementation
- Each workspace is isolated per issue
- Always create AGENTS.md, README.md, and docs/ in every project
