# Interactive Launcher Mode Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the interactive launcher ask for execution mode first, default to local mode, and require `downloadUrl` when remote mode is chosen.

**Architecture:** Keep the launcher as a thin orchestration layer. Extract small normalization helpers for execution mode and remote inputs so tests can verify behavior without driving `readline`, then branch into `runSingleCase` or `runRemoteTask`.

**Tech Stack:** TypeScript, Node.js readline/promises, node:test

---

### Task 1: Define Mode-Normalization Behavior

**Files:**
- Modify: `src/tools/runInteractiveScore.ts`
- Test: `tests/interactive-launcher.test.ts`

- [ ] Step 1: Write failing tests for default `local` mode and normalized `remote` mode.
- [ ] Step 2: Run `npm test -- tests/interactive-launcher.test.ts` and verify the new launcher-mode tests fail.
- [ ] Step 3: Add minimal normalization helpers for execution mode and remote launcher answers.
- [ ] Step 4: Re-run `npm test -- tests/interactive-launcher.test.ts` and verify failures move to missing launcher branching.

### Task 2: Branch Interactive Execution

**Files:**
- Modify: `src/tools/runInteractiveScore.ts`
- Test: `tests/interactive-launcher.test.ts`

- [ ] Step 1: Write a failing test that checks the launcher source references mode selection, `downloadUrl`, and `runRemoteTask`.
- [ ] Step 2: Run `npm test -- tests/interactive-launcher.test.ts` and verify the source-level launcher test fails.
- [ ] Step 3: Implement the first-question mode prompt and branch into `runSingleCase` or `runRemoteTask`.
- [ ] Step 4: Re-run `npm test -- tests/interactive-launcher.test.ts` and verify the launcher tests pass.

### Task 3: Verify

**Files:**
- Modify: `README.md` if launcher docs need refresh
- Test: targeted launcher suite and type-check build

- [ ] Step 1: Run `npm test -- tests/interactive-launcher.test.ts`.
- [ ] Step 2: Run `npm run build`.
- [ ] Step 3: Update documentation only if the launcher usage text is now misleading.
