# Quality & Test Coverage

## Test Matrix

144 tests across 11 test files covering all spec sections.

| Test File | Tests | Spec Coverage |
|-----------|-------|---------------|
| `tests/unit/types.test.ts` | 8 | Section 4 — domain model helpers |
| `tests/unit/config.test.ts` | 27 | Sections 5–6 — workflow parsing, config, validation |
| `tests/unit/tracker.test.ts` | 10 | Section 11 — ADO normalization, queries |
| `tests/unit/workspace.test.ts` | 16 | Section 9 — workspace safety, hooks, lifecycle |
| `tests/unit/prompt.test.ts` | 13 | Section 12 — strict Liquid rendering |
| `tests/unit/agent.test.ts` | 19 | Section 10 — protocol, events, tool calls |
| `tests/unit/orchestrator.test.ts` | 25 | Sections 7–8 — dispatch, reconciliation, retry |
| `tests/unit/server.test.ts` | 10 | Section 13.7 — HTTP API routes |
| `tests/unit/shim.test.ts` | 6 | Extension — copilot protocol shim |
| `tests/unit/registry.test.ts` | 1 | Extension — registry catalog |
| `tests/integration/orchestrator.test.ts` | 9 | End-to-end lifecycle |

## Running Tests

```bash
npm test              # run all tests once
npm run test:watch    # watch mode
npx vitest run tests/unit/workspace.test.ts  # single file
```

## Spec Conformance Checklist

See `PLAN.md` for the full implementation checklist with completion markers.
See `.github/instructions/prodspec.instructions.md` Sections 17–18 for the
formal test and validation matrix.

## Known Gaps

- Real integration tests (Section 17.8) require live ADO credentials
  and are not run in CI. They pass when credentials are provided.
- Token accounting depends on codex version event shapes; extraction
  is lenient but may miss new payload formats.
