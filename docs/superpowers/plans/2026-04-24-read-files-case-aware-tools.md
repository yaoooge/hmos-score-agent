# Read Files Case-Aware Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared `read_files` tool for both rule and rubric case-aware agents, and deduplicate the shared tool-protocol pieces without merging the two final-answer business schemas.

**Architecture:** Extend the shared case tool layer with a batch file reader that consumes one tool call while still enforcing file-count and byte budgets per returned file. Keep the rule and rubric final-answer protocols separate, but extract shared tool-contract definitions and tool-instruction rendering so both prompts and schemas consume one source of truth.

**Tech Stack:** TypeScript, Node.js test runner, Zod

---

### Task 1: Add Failing Tool Tests

**Files:**
- Modify: `tests/case-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that assert:
- `read_files` accepts `paths` and returns two file payloads in order.
- `read_files` rejects path traversal when any path escapes `caseRoot`.
- `read_files` counts unique returned files against `max_files`.
- `read_files` truncates per remaining byte budget instead of crashing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/case-tools.test.ts`
Expected: FAIL because `read_files` is not a known tool/schema branch yet.

- [ ] **Step 3: Write minimal implementation**

Implement shared schema and executor support for `read_files`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/case-tools.test.ts`
Expected: PASS

### Task 2: Add Shared Tool Contract Definitions

**Files:**
- Modify: `src/types.ts`
- Modify: `src/agent/caseToolSchemas.ts`
- Create or modify shared helper under `src/agent/`

- [ ] **Step 1: Write the failing protocol/prompt tests**

Update protocol/prompt tests so both rule and rubric flows accept `read_files` as a legal tool and mention it in tool instructions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/case-aware-protocol.test.ts tests/rubric-case-aware-protocol.test.ts tests/score-agent.test.ts`
Expected: FAIL because tool enums/instructions do not include `read_files`.

- [ ] **Step 3: Implement minimal shared definitions**

Centralize:
- allowed shared tool names
- `read_files` args schema
- reusable tool instruction lines for prompts

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/case-aware-protocol.test.ts tests/rubric-case-aware-protocol.test.ts tests/score-agent.test.ts`
Expected: PASS

### Task 3: Wire Rule and Rubric Prompts to Shared Tool Instructions

**Files:**
- Modify: `src/agent/ruleAssistance.ts`
- Modify: `src/agent/rubricCaseAwarePrompt.ts`

- [ ] **Step 1: Write the failing prompt tests**

Add assertions that both prompt builders mention `read_files` with `args = { paths }` and expose it in `allowed_tools`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/score-agent.test.ts tests/agent-assisted-rule.test.ts tests/rubric-scoring.test.ts`
Expected: FAIL because prompt text and payloads still enumerate only single-file tools.

- [ ] **Step 3: Implement minimal prompt changes**

Replace duplicated tool instruction text with shared rendering so both prompts stay aligned.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/score-agent.test.ts tests/agent-assisted-rule.test.ts tests/rubric-scoring.test.ts`
Expected: PASS

### Task 4: Reuse Shared Tool-Call Schema

**Files:**
- Modify: `src/agent/caseAwareProtocol.ts`
- Modify: `src/agent/rubricCaseAwareProtocol.ts`

- [ ] **Step 1: Write the failing protocol tests**

Add coverage showing both protocols accept `tool: "read_files"` with `args: { paths: [...] }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/case-aware-protocol.test.ts tests/rubric-case-aware-protocol.test.ts`
Expected: FAIL because the shared tool enum/schema does not yet accept the new tool everywhere.

- [ ] **Step 3: Implement minimal refactor**

Extract the repeated tool-call schema to a shared module and make both protocols import it, while leaving each final-answer schema unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/case-aware-protocol.test.ts tests/rubric-case-aware-protocol.test.ts`
Expected: PASS

### Task 5: Exercise Runner Integration

**Files:**
- Modify: `tests/rubric-case-aware-runner.test.ts`
- Modify: `tests/case-aware-agent-runner.test.ts`
- Modify: `src/agent/rubricCaseAwareRunner.ts`
- Modify: `src/agent/caseAwareAgentRunner.ts`

- [ ] **Step 1: Write the failing runner tests**

Add one rule-runner test and one rubric-runner test where the model emits `read_files`, and assert one tool trace entry returns multiple paths.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/rubric-case-aware-runner.test.ts tests/case-aware-agent-runner.test.ts`
Expected: FAIL because runner contracts do not yet advertise or execute `read_files`.

- [ ] **Step 3: Implement minimal runner wiring**

Expose `read_files` in default tool contracts and ensure existing trace logging/reporting still works for multi-path results.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/rubric-case-aware-runner.test.ts tests/case-aware-agent-runner.test.ts`
Expected: PASS

### Task 6: Final Verification

**Files:**
- Modify: none expected beyond previous tasks

- [ ] **Step 1: Run focused regression suite**

Run: `node --import tsx --test tests/case-tools.test.ts tests/case-aware-protocol.test.ts tests/rubric-case-aware-protocol.test.ts tests/case-aware-agent-runner.test.ts tests/rubric-case-aware-runner.test.ts tests/score-agent.test.ts tests/agent-assisted-rule.test.ts tests/rubric-scoring.test.ts`
Expected: PASS

- [ ] **Step 2: Inspect diff for scope**

Run: `git diff -- src/types.ts src/agent/caseToolSchemas.ts src/agent/caseTools.ts src/agent/caseAwareProtocol.ts src/agent/rubricCaseAwareProtocol.ts src/agent/ruleAssistance.ts src/agent/rubricCaseAwarePrompt.ts src/agent/caseAwareAgentRunner.ts src/agent/rubricCaseAwareRunner.ts tests/case-tools.test.ts tests/case-aware-protocol.test.ts tests/rubric-case-aware-protocol.test.ts tests/case-aware-agent-runner.test.ts tests/rubric-case-aware-runner.test.ts tests/score-agent.test.ts tests/agent-assisted-rule.test.ts tests/rubric-scoring.test.ts`
Expected: only `read_files` support and shared tool-protocol deduplication changes
