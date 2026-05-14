# Low Priority Lint And Rule False Positive Design

## Goal

Reduce developer disagreement by making lint/style findings low priority and fixing known static rule false positives, starting with `ARKTS-FORBID-026`.

## Scope

- Treat every `OFFICIAL-LINTER:@performance/*` and `OFFICIAL-LINTER:@hw-stylistic/*` rule as low-priority scoring evidence.
- Emit low-risk result items for those official linter families instead of medium/high risk.
- Keep official linter findings visible in reports and score fusion details.
- Fix `ARKTS-FORBID-026` so it only flags control-flow keywords inside the `finally` block body.

## Design

Official linter priority belongs in scoring profiles, not in the parser. The parser should continue preserving the linter's raw finding severity. `src/scoring/officialLinterRuleProfiles.ts` will define `@performance/*` and `@hw-stylistic/*` profiles with light severity.

Risk item severity will be derived from rule impact severity instead of rule source alone. Light rule impacts become `low`, medium impacts become `medium`, and heavy impacts become `high`. This keeps forbidden runtime rules high while preventing lint/style rules from being promoted to medium only because they are represented as rule violations.

`ARKTS-FORBID-026` will stop using one greedy cross-file regular expression. Its detector should match each `finally { ... }` block and inspect only that block for `return`, `break`, `continue`, or `throw`.

## Testing

- Add profile tests proving `@performance/*` and `@hw-stylistic/*` official linter profiles are light.
- Add score fusion tests proving official linter `@performance/*` and `@hw-stylistic/*` violations emit `low` risks.
- Add rule engine tests proving `finally { this.isLoading = false; }` followed by a later `throw` outside the block does not trigger `ARKTS-FORBID-026`, while a `throw` inside the finally block still does.
