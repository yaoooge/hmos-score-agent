# Agent Skill Output Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the three opencode agent contracts into project-local skills, trigger the matching skill in each invocation, and migrate reference material into skill-scoped `references/` directories.

**Architecture:** Keep the TypeScript runners as the hard validation layer and make skills the maintainable role-contract layer. Runtime config generation copies prompts, formatters, and skill directories into both runtime and isolated XDG config locations. Existing root `references/` remains during the transition while skill-scoped references are added.

**Tech Stack:** TypeScript, Node test runner, opencode project config, Markdown skill files, YAML/JSON references.

---

### Task 1: Config And Runtime Skill Tests

**Files:**
- Modify: `tests/opencode-config.test.ts`
- Modify: `tests/opencode-config-generation.test.ts`

- [ ] Write failing tests that assert each agent allows only its matching skill, all three `SKILL.md` files exist, required skill references are present, and runtime generation copies skills to `.opencode/runtime/skills` plus `.opencode/runtime/xdg-config/opencode/skills`.
- [ ] Run `npm test -- tests/opencode-config.test.ts tests/opencode-config-generation.test.ts` and verify the tests fail because `.opencode/skills` and runtime copying are not implemented.

### Task 2: Agent Prompt Skill Trigger Tests

**Files:**
- Modify: `tests/opencode-task-understanding.test.ts`
- Modify: `tests/opencode-rubric-scoring.test.ts`
- Modify: `tests/opencode-rule-assessment.test.ts`

- [ ] Write failing tests that first-run and retry prompts include the matching skill name and mandatory skill trigger wording.
- [ ] Preserve existing retry compactness assertions so retry prompts do not leak full payloads.
- [ ] Run `npm test -- tests/opencode-task-understanding.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts` and verify the tests fail because prompts do not trigger skills yet.

### Task 3: Add Skills And Skill References

**Files:**
- Create: `.opencode/skills/hmos-understanding/SKILL.md`
- Create: `.opencode/skills/hmos-understanding/references/README.md`
- Create: `.opencode/skills/hmos-rubric-scoring/SKILL.md`
- Create/copy: `.opencode/skills/hmos-rubric-scoring/references/scoring/*`
- Create: `.opencode/skills/hmos-rule-assessment/SKILL.md`
- Create/copy: `.opencode/skills/hmos-rule-assessment/references/rules/*`
- Create/copy: `.opencode/skills/hmos-rule-assessment/references/scoring/rules_application.md`

- [ ] Add the three `SKILL.md` files using the contracts from the spec.
- [ ] Copy `references/scoring` into the rubric-scoring skill, excluding `.DS_Store`.
- [ ] Copy `references/rules/*.yaml` and `references/scoring/rules_application.md` into the rule-assessment skill.
- [ ] Add an understanding reference README explaining that the skill intentionally has no business references.

### Task 4: Opencode Template And Runtime Copying

**Files:**
- Modify: `.opencode/opencode.template.json`
- Modify: `src/opencode/opencodeConfig.ts`

- [ ] Change agent-level `permission.skill` from deny to per-agent allowlist for only the matching skill.
- [ ] Keep global `permission.skill` denied.
- [ ] Extend runtime directory creation with `skills` and `xdg-config/opencode/skills`.
- [ ] Add recursive skill-directory copying and required `SKILL.md` validation.
- [ ] Run config tests and verify they pass.

### Task 5: Prompt And System Prompt Triggering

**Files:**
- Modify: `.opencode/prompts/hmos-understanding-system.md`
- Modify: `.opencode/prompts/hmos-rubric-scoring-system.md`
- Modify: `.opencode/prompts/hmos-rule-assessment-system.md`
- Modify: `src/agent/opencodeTaskUnderstanding.ts`
- Modify: `src/agent/opencodeRubricScoring.ts`
- Modify: `src/agent/opencodeRuleAssessment.ts`

- [ ] Convert system prompts to thin wrappers that require using the matching skill while preserving output-file protocol.
- [ ] Add first-run and retry skill trigger lines to each TypeScript prompt renderer.
- [ ] Keep dynamic payload and failure-specific guidance in TypeScript.
- [ ] Run agent prompt tests and verify they pass.

### Task 6: Documentation And Final Verification

**Files:**
- Modify: `AGENT.md`

- [ ] Document `.opencode/skills`, per-agent skill permissions, skill-scoped references, and runtime copying.
- [ ] Run focused tests: `npm test -- tests/opencode-config.test.ts tests/opencode-config-generation.test.ts tests/opencode-task-understanding.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts tests/opencode-cli-runner.test.ts`
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
