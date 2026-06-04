# Rules Clean Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `src/rules` into clean responsibility-based modules while preserving all existing behavior and import compatibility.

**Architecture:** Add new responsibility-focused directories and move implementation behind stable compatibility re-export files. Start with low-risk shared layers, then split larger evaluator and official-linter modules once imports are stable.

**Tech Stack:** TypeScript ESM, Node built-in test runner, `tsx`, existing `js-yaml` parser.

---

## File Structure

- Create `src/rules/evidence/*` for evidence collection, patch scope parsing, path policy, and evidence types.
- Create `src/rules/types/ruleTypes.ts` for registered rule domain types.
- Create `src/rules/rule-pack/*` for YAML schema constants, validators, parser, and loader.
- Create `src/rules/registry/*` for rule pack registry constants and runtime rule normalization.
- Create `src/rules/case-constraints/*` for case constraint parsing and mapping.
- Keep old files as compatibility exports until all call sites are ready to migrate.

## Task 1: Add Design Documents

**Files:**
- Create: `docs/superpowers/specs/2026-06-04-rules-clean-structure-design.md`
- Create: `docs/superpowers/plans/2026-06-04-rules-clean-structure.md`

- [ ] **Step 1: Write the design and implementation plan**

Create the two markdown files describing the target structure, compatibility strategy, task order, and verification commands.

- [ ] **Step 2: Verify docs are present**

Run: `test -f docs/superpowers/specs/2026-06-04-rules-clean-structure-design.md && test -f docs/superpowers/plans/2026-06-04-rules-clean-structure.md`

Expected: exit code 0.

## Task 2: Migrate Evidence Collection

**Files:**
- Create: `src/rules/evidence/types.ts`
- Create: `src/rules/evidence/pathPolicy.ts`
- Create: `src/rules/evidence/patchScope.ts`
- Create: `src/rules/evidence/collectEvidence.ts`
- Modify: `src/rules/evidenceCollector.ts`

- [ ] **Step 1: Move evidence types**

Move `WorkspaceFile` and `CollectedEvidence` into `src/rules/evidence/types.ts`.

- [ ] **Step 2: Move path filtering policy**

Move rule evaluation ignored path constants and `isRuleEvaluationIgnoredPath` into `src/rules/evidence/pathPolicy.ts`.

- [ ] **Step 3: Move patch parsing**

Move `PatchScope`, `normalizeRelativePath`, and `parsePatchScope` into `src/rules/evidence/patchScope.ts`.

- [ ] **Step 4: Move collection implementation**

Move `collectEvidence` and `deriveCaseDir` into `src/rules/evidence/collectEvidence.ts`.

- [ ] **Step 5: Keep compatibility export**

Replace `src/rules/evidenceCollector.ts` with exports from the new evidence files.

- [ ] **Step 6: Verify evidence behavior**

Run: `node --import tsx --test tests/rule-engine.test.ts`

Expected: all tests in the file pass.

## Task 3: Migrate Rule Types, Registry, and YAML Loader

**Files:**
- Create: `src/rules/types/ruleTypes.ts`
- Create: `src/rules/rule-pack/schema.ts`
- Create: `src/rules/rule-pack/validators.ts`
- Create: `src/rules/rule-pack/yamlParser.ts`
- Create: `src/rules/rule-pack/yamlLoader.ts`
- Create: `src/rules/registry/constants.ts`
- Create: `src/rules/registry/runtimeRuleNormalizer.ts`
- Create: `src/rules/registry/rulePackRegistry.ts`
- Modify: `src/rules/engine/ruleTypes.ts`
- Modify: `src/rules/engine/rulePackYamlLoader.ts`
- Modify: `src/rules/engine/rulePackRegistry.ts`

- [ ] **Step 1: Move rule domain types**

Move all exports from `src/rules/engine/ruleTypes.ts` into `src/rules/types/ruleTypes.ts`, then re-export from the old file.

- [ ] **Step 2: Split YAML constants**

Move YAML supported keys, allowed detector modes, fallback policies, metric groups, impacts, and file ordering into `src/rules/rule-pack/schema.ts`.

- [ ] **Step 3: Split YAML validators**

Move `assertSupportedKeys`, `expectRecord`, `expectString`, `expectBoolean`, `expectStringArray`, `expectPriority`, `expectImpact`, and `expectMetricGroups` into `src/rules/rule-pack/validators.ts`.

- [ ] **Step 4: Split YAML parser**

Move parse functions into `src/rules/rule-pack/yamlParser.ts`.

- [ ] **Step 5: Split YAML loader**

Move file reading and sorting into `src/rules/rule-pack/yamlLoader.ts`.

- [ ] **Step 6: Split registry constants and runtime normalization**

Move default pack constants into `src/rules/registry/constants.ts` and runtime rule normalization into `src/rules/registry/runtimeRuleNormalizer.ts`.

- [ ] **Step 7: Keep compatibility exports**

Replace old `engine` files with re-exports from the new modules.

- [ ] **Step 8: Verify registry behavior**

Run: `node --import tsx --test tests/rule-pack-yaml-loader.test.ts tests/rule-pack-registry.test.ts`

Expected: all tests in both files pass.

## Task 4: Migrate Case Constraint Loader

**Files:**
- Create: `src/rules/case-constraints/types.ts`
- Create: `src/rules/case-constraints/parser.ts`
- Create: `src/rules/case-constraints/mapper.ts`
- Create: `src/rules/case-constraints/loader.ts`
- Modify: `src/rules/caseConstraintLoader.ts`

- [ ] **Step 1: Move raw case constraint types**

Move raw YAML interfaces into `src/rules/case-constraints/types.ts`.

- [ ] **Step 2: Move parser and validators**

Move case constraint YAML parsing and validation into `src/rules/case-constraints/parser.ts`.

- [ ] **Step 3: Move mapper logic**

Move constraint-to-rule mapping helpers into `src/rules/case-constraints/mapper.ts`.

- [ ] **Step 4: Keep compatibility export**

Replace `src/rules/caseConstraintLoader.ts` with a re-export from `src/rules/case-constraints/loader.ts`.

- [ ] **Step 5: Verify case constraint behavior**

Run: `node --import tsx --test tests/case-constraint-loader.test.ts`

Expected: all tests in the file pass.

## Task 5: Final Verification

**Files:**
- Review all touched files.

## Task 5: Split Rule Engine Core

**Files:**
- Create: `src/rules/core/evaluationDispatcher.ts`
- Create: `src/rules/core/evidenceIndex.ts`
- Create: `src/rules/core/assistedRuleMapper.ts`
- Create: `src/rules/core/ruleEngine.ts`
- Modify: `src/rules/ruleEngine.ts`

- [ ] **Step 1: Move evaluator dispatch**

Move detector mode dispatch from `src/rules/ruleEngine.ts` into `src/rules/core/evaluationDispatcher.ts`.

- [ ] **Step 2: Move evidence index helpers**

Move matched file/snippet fallback logic into `src/rules/core/evidenceIndex.ts`.

- [ ] **Step 3: Move assisted candidate mapping**

Move `AssistedRuleCandidate` field extraction and target check normalization into `src/rules/core/assistedRuleMapper.ts`.

- [ ] **Step 4: Move rule engine entry**

Move `runRuleEngine` and `RuleEngineOutput` into `src/rules/core/ruleEngine.ts`.

- [ ] **Step 5: Keep compatibility export**

Replace `src/rules/ruleEngine.ts` with a re-export from `src/rules/core/ruleEngine.ts`.

- [ ] **Step 6: Verify rule engine behavior**

Run: `node --import tsx --test tests/rule-engine.test.ts tests/score-fusion.test.ts`

Expected: rule-engine tests pass; score-fusion behavior remains unchanged.

## Task 6: Classify Evaluator Entrypoints

**Files:**
- Create grouped evaluator directories under `src/rules/evaluators/`
- Modify old evaluator files to re-export from grouped directories.

- [ ] **Step 1: Move ArkTS evaluator files**

Move `arktsLightScanner.ts` and `arktsStaticEvaluator.ts` under `src/rules/evaluators/arkts/`.

- [ ] **Step 2: Move ArkUI evaluator files**

Move `arkuiStaticScanner.ts`, `arkuiStaticEvaluator.ts`, and `arkuiExtraEvaluator.ts` under `src/rules/evaluators/arkui/`.

- [ ] **Step 3: Move generic evaluator files**

Move `textPatternEvaluator.ts`, `projectStructureEvaluator.ts`, and `caseConstraintEvaluator.ts` under purpose-specific subdirectories.

- [ ] **Step 4: Keep compatibility exports**

Replace the original evaluator files with re-exports so old imports continue to work.

- [ ] **Step 5: Verify evaluator behavior**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts tests/arkui-static-scanner.test.ts tests/rule-engine.test.ts`

Expected: all tests pass.

## Task 7: Classify Official Linter Entrypoints

**Files:**
- Create: `src/rules/official-linter/config/*`
- Create: `src/rules/official-linter/run/*`
- Create: `src/rules/official-linter/parse/*`
- Create: `src/rules/official-linter/map/*`
- Create: `src/rules/official-linter/hvigor/*`
- Modify: `src/rules/officialCodeLinter/*`

- [ ] **Step 1: Move config files**

Move `configWriter.ts` and `recommendedRuleSets.ts` into `official-linter/config`.

- [ ] **Step 2: Move run files**

Move `runner.ts` and `workspacePreparer.ts` into `official-linter/run`.

- [ ] **Step 3: Move parse/map files**

Move `parser.ts`, `sanitizer.ts`, and `resultMapper.ts` into `official-linter/parse` and `official-linter/map`.

- [ ] **Step 4: Move hvigor build check**

Move `hvigorBuildCheck.ts` into `official-linter/hvigor/buildCheck.ts`.

- [ ] **Step 5: Keep compatibility exports**

Replace original `officialCodeLinter` files with re-exports.

- [ ] **Step 6: Verify official linter behavior**

Run: `node --import tsx --test tests/official-code-linter-config.test.ts tests/official-code-linter-filtering.test.ts tests/official-code-linter-node.test.ts tests/official-code-linter-parser.test.ts tests/official-linter-rule-profiles.test.ts`

Expected: all tests pass.

## Task 8: Final Verification

**Files:**
- Review all touched files.

- [ ] **Step 1: Run rule-related tests**

Run: `node --import tsx --test tests/rule-engine.test.ts tests/rule-pack-yaml-loader.test.ts tests/rule-pack-registry.test.ts tests/case-constraint-loader.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run TypeScript build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Review diff**

Run: `git diff --stat` and `git diff --check`

Expected: no whitespace errors; diff only contains docs and planned `src/rules` restructuring.
