# Remote Network Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a remote task download and callback upload flow that materializes remote case data into the existing scoring workflow.

**Architecture:** Keep the existing workflow unchanged where possible. Add a small remote-task adapter that fetches task metadata, writes a temporary local case directory, then reuses the current scoring pipeline and posts the result to the task callback endpoint.

**Tech Stack:** TypeScript, Node.js fetch, Express, node:test

---

### Task 1: Define Remote Contracts

**Files:**
- Modify: `src/types.ts`
- Test: `tests/score-agent.test.ts`

- [ ] Step 1: Write a failing test for remote payload shaping.
- [ ] Step 2: Run `npm test -- tests/score-agent.test.ts` and verify the new test fails for missing remote task support.
- [ ] Step 3: Add remote task and callback payload types with only the fields needed by this feature.
- [ ] Step 4: Re-run `npm test -- tests/score-agent.test.ts` and verify the failure moves to missing implementation.

### Task 2: Materialize Remote Cases

**Files:**
- Modify: `src/io/downloader.ts`
- Modify: `src/service.ts`
- Test: `tests/score-agent.test.ts`

- [ ] Step 1: Write a failing test that mocks fetch for download metadata and remote file manifests.
- [ ] Step 2: Run `npm test -- tests/score-agent.test.ts` and verify it fails on missing remote materialization.
- [ ] Step 3: Implement remote task download plus manifest-to-directory writing for `original/`, `workspace/`, and optional patch.
- [ ] Step 4: Re-run `npm test -- tests/score-agent.test.ts` and verify the remote case test passes.

### Task 3: Upload Callback Results

**Files:**
- Modify: `src/io/uploader.ts`
- Modify: `src/service.ts`
- Test: `tests/score-agent.test.ts`

- [ ] Step 1: Write a failing test that asserts callback URL, `token` header, and payload fields.
- [ ] Step 2: Run `npm test -- tests/score-agent.test.ts` and verify it fails on missing callback upload support.
- [ ] Step 3: Implement callback upload helpers for success and failure payloads.
- [ ] Step 4: Re-run `npm test -- tests/score-agent.test.ts` and verify the callback test passes.

### Task 4: Expose HTTP Entry

**Files:**
- Modify: `src/index.ts`
- Possibly create: `src/app.ts`
- Test: `tests/interactive-launcher.test.ts` or `tests/score-agent.test.ts`

- [ ] Step 1: Write a failing test for `POST /score/run-remote`.
- [ ] Step 2: Run the targeted test and verify the route is absent.
- [ ] Step 3: Add an API handler that accepts `downloadUrl` and returns execution metadata.
- [ ] Step 4: Re-run the targeted test and verify the route passes.

### Task 5: Verify and Document

**Files:**
- Modify: `README.md`
- Test: full targeted suite

- [ ] Step 1: Run `npm test -- tests/score-agent.test.ts tests/interactive-launcher.test.ts`.
- [ ] Step 2: Run `npm run build`.
- [ ] Step 3: Document the new `POST /score/run-remote` contract and callback behavior in `README.md`.
