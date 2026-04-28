# Human Review Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Follow TDD for every production change: write a failing test first, confirm the expected failure, then implement the minimum code to pass.

**Goal:** Add a management-console-triggered human review ingestion path that stores raw review submissions immediately, processes classification asynchronously, filters non-code-generation review points, and writes training-oriented evidence/dataset files into a production-safe persistent directory.

**Architecture:** `POST /score/remote-tasks/:taskId/human-review` validates the completed remote task and token, reads `outputs/result.json`, writes a raw review record, creates queued status, starts `HumanReviewIngestionNode` in the background, and returns success without waiting for classification. The node normalizes review items, filters process/scoring-only items such as hard gate review, classifies eligible code-generation items through an injectable classifier, writes classified evidence cards and JSONL datasets, then updates status and index files.

**Tech Stack:** TypeScript, Express 5, Node `fs/promises`, Node test runner, file-backed stores.

---

## File Map

- Create `src/humanReview/humanReviewTypes.ts`: request, status, raw record, classified evidence, and dataset sample types.
- Create `src/humanReview/humanReviewFiltering.ts`: deterministic training eligibility filtering and polarity mapping.
- Create `src/humanReview/humanReviewEvidenceStore.ts`: file-backed raw/status/classified/index/JSONL store with serialized writes.
- Create `src/agent/humanReviewEvidenceClassifier.ts`: default classifier contract and conservative fallback summarizer.
- Create `src/humanReview/humanReviewIngestionNode.ts`: asynchronous orchestration for normalization, filtering, classification, storage, and status updates.
- Create `src/api/humanReviewHandler.ts`: Express handler for task/token/status validation, result loading, raw write, background node start, and status query.
- Modify `src/api/apiDefinitions.ts`: add human review submit/status paths and documentation.
- Modify `src/api/app.ts`: mount submit/status handlers with remote task registry and human review store.
- Modify `src/config.ts`: add `humanReviewEvidenceRoot`, production/development defaults, and warning helper if needed.
- Modify `scripts/aliyun-single-instance-deploy.sh`: write `LOCAL_CASE_ROOT=/data/hmos-score-agent/local-cases` and `HUMAN_REVIEW_EVIDENCE_ROOT=/data/hmos-score-agent/human-review-evidences`, create directories, and set ownership.
- Test `tests/human-review-ingestion.test.ts`: filtering, store, node, API, config, and deploy script coverage.

## Tasks

### Task 1: Add failing filtering tests

- [ ] Create `tests/human-review-ingestion.test.ts` with unit tests for `filterHumanReviewTrainingCandidates` and `mapHumanVerdictToPolarity`.
- [ ] Cover default filtering for `硬门槛复核`, `Patch 上下文缺失`, `Rubric Agent 降级`, `置信度复核`, `humanVerdict=uncertain`, missing code evidence, and score-only adjustment.
- [ ] Cover eligible code-generation cases for `api_integration`, `requirement_following`, `arkts_language`, and `auto_false_positive`.
- [ ] Run `node --import tsx --test tests/human-review-ingestion.test.ts`; expected failure is missing module exports.

### Task 2: Implement filtering and types

- [ ] Create `src/humanReview/humanReviewTypes.ts` and `src/humanReview/humanReviewFiltering.ts`.
- [ ] Implement deterministic filter reasons: `process_or_scoring_review_point`, `missing_code_evidence`, `uncertain_human_verdict`, `score_only_adjustment`, `non_generation_related`, `duplicate_item`, and `unsupported_payload`.
- [ ] Implement polarity mapping without allowing Agent logic to invert confirmed human judgement.
- [ ] Run `node --import tsx --test tests/human-review-ingestion.test.ts`; filtering tests should pass.

### Task 3: Add failing evidence store tests

- [ ] Extend `tests/human-review-ingestion.test.ts` for `createHumanReviewEvidenceStore(root)`.
- [ ] Assert raw records write under `raw/YYYY-MM-DD`, status writes under `status`, classified cards write under `classified/<polarity>/<category>`, datasets append to the correct JSONL, and `index.json` is updated.
- [ ] Assert repeated/parallel writes do not overwrite existing JSONL lines.
- [ ] Run focused test; expected failure is missing store implementation.

### Task 4: Implement evidence store

- [ ] Create `src/humanReview/humanReviewEvidenceStore.ts` with serialized write queue.
- [ ] Use atomic temp-file + rename for JSON documents and append-only writes for JSONL.
- [ ] Keep `index.json` metadata-only; do not store full source or large patch bodies.
- [ ] Run focused test; store tests should pass.

### Task 5: Add failing ingestion node tests

- [ ] Add tests for `runHumanReviewIngestionNode` using an injected fake classifier.
- [ ] Prove non-code review points are filtered before classifier invocation.
- [ ] Prove eligible negative items produce `negative_diagnostics.jsonl` and eligible positive items produce `sft_positive.jsonl`.
- [ ] Prove classifier failure writes failed status and does not append training JSONL.
- [ ] Run focused test; expected failure is missing ingestion node implementation.

### Task 6: Implement classifier contract and ingestion node

- [ ] Create `src/agent/humanReviewEvidenceClassifier.ts` with the classifier input/output schema and a conservative default classifier that builds evidence cards from confirmed facts.
- [ ] Create `src/humanReview/humanReviewIngestionNode.ts` to normalize keys, match `resultJson.human_review_items`, filter candidates, call classifier, validate output, write classified evidence and datasets, and update status.
- [ ] Ensure fallback on classifier failure writes neutral classified records only and no training JSONL.
- [ ] Run focused test; ingestion node tests should pass.

### Task 7: Add failing API tests

- [ ] Add tests around an Express app mounting the new handlers.
- [ ] Cover success path: completed task + matching token writes raw/status and returns `classificationStatus=queued` without awaiting a delayed node promise.
- [ ] Cover `401` token mismatch, `404` missing task/result, `409` incomplete task, and `400` invalid body.
- [ ] Cover `GET /score/human-reviews/:reviewId` status response.
- [ ] Run focused test; expected failure is missing handler/API paths.

### Task 8: Implement API integration

- [ ] Add `humanReview` and `humanReviewStatus` to `API_PATHS` and API definitions.
- [ ] Create `src/api/humanReviewHandler.ts`.
- [ ] Mount handlers in `src/api/app.ts`, wiring registry, store, config root, and background ingestion runner.
- [ ] Keep submit response synchronous only through raw/status write; start ingestion via `void` background call.
- [ ] Run focused API tests; they should pass.

### Task 9: Add failing config/deploy tests

- [ ] Add config tests proving `humanReviewEvidenceRoot` respects `HUMAN_REVIEW_EVIDENCE_ROOT` and has a local development fallback.
- [ ] Add deploy script text tests proving `.env` includes `LOCAL_CASE_ROOT=/data/hmos-score-agent/local-cases` and `HUMAN_REVIEW_EVIDENCE_ROOT=/data/hmos-score-agent/human-review-evidences`.
- [ ] Add deploy script text tests proving both `/data` directories are created and chowned to the service user.
- [ ] Run focused tests; expected failure is missing config/script changes.

### Task 10: Implement config and deploy script changes

- [ ] Modify `src/config.ts` to expose `humanReviewEvidenceRoot`.
- [ ] Modify `scripts/aliyun-single-instance-deploy.sh` defaults, `.env` generation, directory creation, and ownership handling.
- [ ] Ensure deployment script never deletes `/data/hmos-score-agent`.
- [ ] Run focused config/deploy tests; they should pass.

### Task 11: Final verification

- [ ] Run `node --import tsx --test tests/human-review-ingestion.test.ts`.
- [ ] Run existing impacted tests: `tests/remote-network-execution.test.ts`, `tests/config-reference.test.ts`, and any API definition tests updated in the focused file.
- [ ] Run `npm run build`.
- [ ] Run `npm test` if focused tests and build pass.
- [ ] Review diff against spec: async response, non-code filtering, persistent `/data` root, deploy script env writing, no workflow coupling, no long synchronous Agent wait.
