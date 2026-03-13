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
    # Copy SKILL.md into agent workspace for the agent to read
    SKILL_SOURCE="../../.symphony/SKILL.md"
    if [ -f "$SKILL_SOURCE" ]; then
      cp "$SKILL_SOURCE" ./SKILL.md
    fi
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
  command: wsl source ~/.nvm/nvm.sh && codex app-server
  approval_policy: never
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
server:
  port: 3000
---
You are a senior software engineer working on an AI Agent Marketplace project.

**Read `SKILL.md` in your workspace first** — it contains the full workflow you must follow (triage, status updates, planning, implementation, closing).

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

### ADO API Details
- Project: `agent-marketplace`
- Work item ID: `{{ issue.identifier }}`
- API path: `/agent-marketplace/_apis/wit/workitems/{{ issue.identifier }}?api-version=7.1`

Follow the workflow in `SKILL.md` now.
