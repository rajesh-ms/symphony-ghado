# Symphony Agent Skill — ADO Issue Workflow

> This skill defines the standard workflow for any coding agent working on Azure DevOps issues dispatched by Symphony.

## Work Item Triage

| Work Item Type | Action |
|----------------|--------|
| **Epic** | Do NOT implement code. Epics are parent-level tracking items. Instead, check if all child work items (User Stories/Tasks/Bugs) are in a terminal state ("Done"/"Closed"). If **all** children are closed, set the Epic to "Done". If any child is still open, leave the Epic as-is and skip. |
| **User Story** | Actionable. Follow the full workflow below. |
| **Task** | Actionable. Follow the full workflow below. |
| **Bug** | Actionable. Follow the full workflow below. |

### Epic Closure Check

When an Epic is picked up, query its child work items using `ado_api`:
- `method: "GET"`
- `path: "/<project>/_apis/wit/workitems/<id>?$expand=relations&api-version=7.1"`

Inspect the relations for child links. For each child, fetch its state. If **every** child is in a terminal state ("Done", "Closed", or "Removed"), then close the Epic:
- `method: "PATCH"`
- `path: "/<project>/_apis/wit/workitems/<id>?api-version=7.1"`
- `body: [{"op": "replace", "path": "/fields/System.State", "value": "Done"}]`
- Content-Type: `application/json-patch+json`

If any child is still open, do **not** close the Epic. Leave it unchanged.

## Workflow

### Step 1 — Set status to "Doing"

Before any implementation work, **immediately** update the ADO work item state to "Doing" using `ado_api`:
- `method: "PATCH"`
- `path: "/<project>/_apis/wit/workitems/<id>?api-version=7.1"`
- `body: [{"op": "replace", "path": "/fields/System.State", "value": "Doing"}]`
- Content-Type: `application/json-patch+json`

This ensures the board reflects work-in-progress before any code is written.

### Step 2 — Research and plan

Read the issue description carefully. Extract the **acceptance criteria** from the description section.

Create a `PLAN.md` file in the workspace with:
1. **User story summary** — one paragraph describing the goal
2. **Acceptance criteria checklist** — each criterion as a `- [ ]` item, copied verbatim from the description
3. **Implementation plan** — which files to create, what each module does, how they connect
4. **Assumptions** — anything not explicit in the description that you're assuming

**Do NOT start coding until the plan is written.**

### Step 3 — Implement

Follow your plan from Step 2:

1. **Initialize project structure** (e.g., `package.json`, `tsconfig.json`)
2. **Write the implementation code** — real, working code, not stubs or placeholders
3. **Add tests** — cover the core logic and edge cases
4. **Create documentation**:
   - `README.md` — project overview, setup, usage examples
   - `AGENTS.md` — repo map, key files, build/test commands, architecture summary
   - `docs/architecture.md` — system layers, data flow, concurrency model, key invariants
   - `docs/decisions.md` — design decisions with rationale and alternatives considered
5. **Verify acceptance criteria** — check each item against what was built. Update `PLAN.md` to mark completed items as `- [x]`.

### Step 4 — Create a pull request

Before the issue can be marked as "Done", a pull request **must** be created. Use `ado_api` to create a PR from the issue branch to `main`:
- `method: "POST"`
- `path: "/<project>/_apis/git/repositories/<repo>/pullrequests?api-version=7.1"`
- `body: {"sourceRefName": "refs/heads/<branch>", "targetRefName": "refs/heads/main", "title": "<issue.identifier>: <issue.title>", "description": "<summary of changes and acceptance criteria met>"}`

If the PR creation fails, **do not** proceed to Step 5. Log the error and leave the issue in "Doing" state.

### Step 5 — Comment and close

**Prerequisite**: Step 4 must have succeeded (PR created).

1. **Add a summary comment** to the ADO work item describing what was built, how each acceptance criterion was satisfied, and a link to the PR:
   - `method: "PATCH"`
   - `path: "/<project>/_apis/wit/workitems/<id>?api-version=7.1"`
   - `body: [{"op": "add", "path": "/fields/System.History", "value": "<summary with PR link>"}]`
   - Content-Type: `application/json-patch+json`

2. **Change state to "Done"**:
   - `method: "PATCH"`
   - `path: "/<project>/_apis/wit/workitems/<id>?api-version=7.1"`
   - `body: [{"op": "replace", "path": "/fields/System.State", "value": "Done"}]`

## Key Constraints

- Write real, working code — not stubs or placeholders
- Use TypeScript/Node.js unless the issue specifies otherwise
- Each workspace is isolated per issue
- Always create `AGENTS.md`, `README.md`, and `docs/` in every project
- Always write `PLAN.md` before coding
- On retry/continuation: read `SYMPHONY_PROGRESS.md` and existing files to understand prior work before resuming
