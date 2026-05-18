# Cross-Device Conditional Rule Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in HarmonyOS one-to-many adaptation rule pack that is enabled only when task understanding marks the case as cross-device involved.

**Architecture:** Keep TypeScript rule definitions as the execution source of truth, export YAML through the existing exporter, and add an enabled-pack resolver consumed by `ruleAuditNode` and report generation. The new rules reuse the existing `case_constraint` evaluator for target/kit static precheck while remaining built-in rules, not case rules.

**Tech Stack:** TypeScript, node:test, js-yaml, LangGraph workflow state, existing rule engine/evaluator stack.

---

### Task 1: Rule Pack Registry Selection

**Files:**
- Modify: `src/rules/engine/rulePackRegistry.ts`
- Test: `tests/rule-engine.test.ts`

- [ ] Write failing tests for default pack ids, cross-device enablement, and explicit pack filtering.
- [ ] Run `node --import tsx --test tests/rule-engine.test.ts` and verify RED.
- [ ] Implement registry filtering and cross-device resolver.
- [ ] Run the same test and verify GREEN.

### Task 2: Cross-Device Rule Definitions and YAML Export

**Files:**
- Modify: `src/rules/packs/shared/ruleFactories.ts`
- Create: `src/rules/packs/cross-device-adaptation/ruleData.ts`
- Create: `src/rules/packs/cross-device-adaptation/must.ts`
- Create: `src/rules/packs/cross-device-adaptation/should.ts`
- Create: `src/rules/packs/cross-device-adaptation/forbidden.ts`
- Modify: `src/rules/engine/rulePackRegistry.ts`
- Modify: `src/rules/engine/rulePackYamlMetadata.ts`
- Modify: `tests/rule-pack-yaml-export.test.ts`
- Generate: `references/rules/cross-device-adaptation.yaml`

- [ ] Write failing YAML export tests.
- [ ] Run `node --import tsx --test tests/rule-pack-yaml-export.test.ts` and verify RED.
- [ ] Add shared factory and generated rule data from `通用规则.md`.
- [ ] Register metadata and run `npm run rulepack:export`.
- [ ] Run YAML export tests and verify GREEN.

### Task 3: Rule Audit Conditional Enablement

**Files:**
- Modify: `src/rules/ruleEngine.ts`
- Modify: `src/nodes/ruleAuditNode.ts`
- Modify: `src/workflow/state.ts`
- Test: `tests/score-agent.test.ts`

- [ ] Write failing rule audit tests for non-cross-device exclusion and cross-device inclusion.
- [ ] Run `node --import tsx --test tests/score-agent.test.ts` and verify RED.
- [ ] Thread enabled pack ids and enabled pack metadata through rule audit state.
- [ ] Run score-agent tests and verify GREEN.

### Task 4: Report Bound Rule Packs

**Files:**
- Modify: `src/nodes/reportGenerationNode.ts`
- Test: `tests/score-agent.test.ts`

- [ ] Write failing report tests for conditional `bound_rule_packs` and `case_rule_results`.
- [ ] Run `node --import tsx --test tests/score-agent.test.ts` and verify RED.
- [ ] Use enabled built-in packs in report generation and keep case packs separate.
- [ ] Run score-agent tests and verify GREEN.

### Task 5: Final Verification

**Files:**
- All modified files

- [ ] Run `npm run build`.
- [ ] Run focused tests: `node --import tsx --test tests/rule-engine.test.ts tests/rule-pack-yaml-export.test.ts tests/task-understanding-parser.test.ts tests/opencode-task-understanding.test.ts tests/score-agent.test.ts`.
- [ ] Run `npm test`.
- [ ] Commit with `git commit -m "feat: add conditional cross-device rule pack"`.
