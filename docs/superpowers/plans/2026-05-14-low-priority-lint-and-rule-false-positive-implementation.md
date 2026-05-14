# Low Priority Lint And Rule False Positive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lint/style risks low priority and fix the `ARKTS-FORBID-026` finally-block false positive.

**Architecture:** Keep raw linter parsing unchanged. Apply official linter priority in `officialLinterRuleProfiles`, derive emitted risk levels from penalty severity in scoring, and replace the greedy `ARKTS-FORBID-026` text detector with a focused evaluator.

**Tech Stack:** TypeScript, Node test runner, existing rule engine and score fusion modules.

---

### Task 1: Official Linter Severity Calibration

**Files:**
- Modify: `tests/official-linter-rule-profiles.test.ts`
- Modify: `tests/score-fusion.test.ts`
- Modify: `src/scoring/officialLinterRuleProfiles.ts`
- Modify: `src/scoring/scoreFusion.ts`
- Modify: `src/scoring/scoringEngine.ts`

- [ ] Write failing tests for light severity profiles and low emitted risks.
- [ ] Run targeted tests and verify they fail for `@performance/*` medium profile or medium emitted risk.
- [ ] Change `@performance/*` profile severity to `light`.
- [ ] Derive rule risk level from impact severity so light rule impacts emit `low`.
- [ ] Run targeted tests and verify they pass.

### Task 2: ARKTS-FORBID-026 False Positive Fix

**Files:**
- Modify: `tests/rule-engine.test.ts`
- Modify: `src/rules/packs/arkts-language/forbidden.ts`
- Modify: `src/rules/packs/shared/ruleFactories.ts`
- Modify: `src/rules/evaluators/textPatternEvaluator.ts`

- [ ] Write failing tests for a safe finally block followed by later `throw`, and for a real throw inside finally.
- [ ] Run the rule-engine test and verify the safe finally case fails today.
- [ ] Add a focused detector option for finally-block control flow.
- [ ] Switch `ARKTS-FORBID-026` to the focused detector option.
- [ ] Run targeted tests and verify they pass.

### Task 3: Verification

**Files:**
- No new files.

- [ ] Run `node --import tsx --test tests/official-linter-rule-profiles.test.ts tests/score-fusion.test.ts tests/rule-engine.test.ts`.
- [ ] Run `npm run build`.
- [ ] Review `git diff` to ensure only scoped files changed.
