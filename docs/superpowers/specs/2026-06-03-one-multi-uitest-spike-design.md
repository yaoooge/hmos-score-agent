# One-Multi UI Test Spike Design

## Goal

Validate a narrow UI automation path for HarmonyOS one-multi adaptation rules without integrating it into the main scoring workflow.

The spike proves that a cloud scoring service can dispatch one UI test task to a local machine, the local runner can execute fixed Hypium UI tests against HarmonyOS emulator profiles, and the runner can upload deterministic JSON evidence back to the cloud service.

This spike is intentionally small. It covers only pure ArkUI component rules for `List` and `Swiper`; it excludes Web rules, full score fusion, dashboard integration, and automatic scoring decisions.

## Non-Goals

- Do not merge UI test execution into the main score workflow.
- Do not run HarmonyOS emulators or DevEco Testing tools on the Linux cloud service.
- Do not rely on runtime window resizing as the primary breakpoint mechanism.
- Do not cover Web, Native-Web synchronization, CSS media query, hover, performance, or visual regression rules.
- Do not generate UI test scripts dynamically per case.

## Official Tooling Assumption

Use the official HarmonyOS UI automation path:

- DevEco Testing Hypium for UI automation scripts.
- DevEco Studio / HarmonyOS SDK / Hvigor / hdc for build, install, and device interaction.
- Local emulator profiles on the runner machine for one-multi breakpoint coverage.

Official testing documentation describes DevEco Testing Hypium as the recommended UI automation framework and notes that CI/CD can call Hypium UI automation cases through a `run` command. The design treats Linux cloud deployment as orchestration only because the documented local emulator and DevEco Testing environments are primarily Windows/macOS oriented.

## Rule Scope

The spike validates three rules:

| Rule ID | Source Rule | Component | Deterministic UI Oracle |
| --- | --- | --- | --- |
| `LIST-001` | `CMP-MUST-01` | `List` | Visible columns / item lanes are non-decreasing from small to wider profiles. |
| `SWIPER-001` | `CMP-MUST-03` | `Swiper` | Visible swiper item count is non-decreasing from small to wider profiles. |
| `SWIPER-002` | `CMP-MUST-04` | `Swiper` | Indicator is present for single-item display and absent for multi-item display. |

The simplified numbering is capped at three segments and grouped by component.

## Component ID Contract

The test scripts locate components only through fixed IDs. Test cases that participate in this spike must expose these IDs in the ArkUI code:

| Component | ID |
| --- | --- |
| Main `List` | `list_001` |
| First representative `ListItem` | `list_item_001` |
| Main `Swiper` | `swiper_001` |
| First representative swiper item | `swiper_item_001` |

If a page contains multiple components of the same type, IDs increment by suffix:

- `list_002`, `list_item_002`
- `swiper_002`, `swiper_item_002`

The spike only requires the `001` IDs.

## Breakpoint Execution Strategy

Do not depend on changing a single device's window size during the test. A single physical device has fixed dimensions, and runtime resize support is not assumed to be stable enough for deterministic scoring.

Use emulator profiles as breakpoint proxies:

| Breakpoint | Preferred Profile | Notes |
| --- | --- | --- |
| `sm` | `om_phone_sm` | Phone-like emulator. |
| `md` | `om_tablet_md` | Tablet-like emulator if available. |
| `lg` | `om_2in1_lg` | Wide / 2in1-like emulator if available. |

If tablet or 2in1 local emulator support is not available on the runner, the spike can still pass the first milestone with one profile. The result must then be marked as `partial` rather than as a complete rule verdict.

## Local Runner Environment

The local runner machine should prepare:

- Windows or macOS machine capable of running DevEco Studio and local emulators.
- DevEco Studio installed.
- HarmonyOS SDK matching the tested project API version.
- DevEco Testing installed.
- DevEco Testing Hypium installed.
- `hdc` and DevEco command-line tools available to the runner process.
- Node.js, `ohpm`, and Hvigor available for project dependency install and build.
- Python runtime required by Hypium scripts.
- At least one runnable local emulator profile.
- Preferred pre-created emulator profiles: `om_phone_sm`, `om_tablet_md`, `om_2in1_lg`.
- Runner config with cloud service URL, auth token, workspace path, and `maxConcurrency: 1`.

Recommended resources:

- Memory: 16 GB minimum, 32 GB recommended.
- Disk: 100 GB available.
- Network: access to the cloud service for task download and result upload.

The cloud Linux service only needs task APIs, storage, and report receiving endpoints. It does not need DevEco Studio, Hypium, hdc, or emulator images.

## Cloud-To-Local Architecture

The cloud service owns orchestration and task state. The local runner owns build, emulator, UI test execution, and artifact collection.

```text
Cloud service
  -> creates one pending UI test task
  -> enforces one running task at a time
  -> serves task package to the local runner
  -> receives JSON result, logs, and screenshots

Local runner
  -> polls or long-polls for one pending task
  -> claims the task atomically
  -> downloads project/test bundle
  -> builds and installs the app
  -> runs fixed Hypium suites on configured emulator profiles
  -> uploads result artifacts
  -> cleans local temporary state
```

The runner must process tasks serially. Even if DevEco Testing supports multi-device execution, this spike intentionally uses one task lock and runner-side `maxConcurrency: 1` to avoid cross-task state pollution.

## Task Contract

Example cloud task payload:

```json
{
  "taskId": "uitest-spike-001",
  "caseId": "case-list-swiper",
  "rules": ["LIST-001", "SWIPER-001", "SWIPER-002"],
  "componentIds": {
    "list": "list_001",
    "listItem": "list_item_001",
    "swiper": "swiper_001",
    "swiperItem": "swiper_item_001"
  },
  "profiles": ["om_phone_sm", "om_tablet_md", "om_2in1_lg"],
  "artifactUrl": "https://cloud.example/tasks/uitest-spike-001/artifact.zip",
  "callbackUrl": "https://cloud.example/ui-test/tasks/uitest-spike-001/result"
}
```

The artifact bundle contains:

- HarmonyOS project or prepared project workspace.
- Fixed Hypium UI test scripts for List and Swiper.
- Runner manifest with package name, entry ability, build command, and expected profiles.

## Result Contract

Example runner result:

```json
{
  "taskId": "uitest-spike-001",
  "caseId": "case-list-swiper",
  "status": "completed",
  "scope": "full",
  "profiles": ["om_phone_sm", "om_tablet_md", "om_2in1_lg"],
  "results": [
    {
      "ruleId": "LIST-001",
      "result": "pass",
      "evidence": {
        "sm": { "visibleColumns": 1 },
        "md": { "visibleColumns": 2 },
        "lg": { "visibleColumns": 3 }
      }
    },
    {
      "ruleId": "SWIPER-001",
      "result": "pass",
      "evidence": {
        "sm": { "visibleItems": 1 },
        "md": { "visibleItems": 2 },
        "lg": { "visibleItems": 3 }
      }
    },
    {
      "ruleId": "SWIPER-002",
      "result": "pass",
      "evidence": {
        "sm": { "indicatorVisible": true },
        "md": { "indicatorVisible": false },
        "lg": { "indicatorVisible": false }
      }
    }
  ],
  "artifacts": {
    "logs": ["hypium.log"],
    "screenshots": ["sm-swiper.png", "md-swiper.png", "lg-swiper.png"]
  }
}
```

Allowed task statuses:

- `completed`: all requested profiles ran and results were produced.
- `partial`: at least one profile ran, but not enough profiles were available for a complete verdict.
- `failed`: build, install, launch, test execution, or upload failed.
- `blocked`: no suitable emulator profile or device environment was available.

Allowed rule results:

- `pass`
- `fail`
- `not_applicable`
- `blocked`

## Static Trigger For The Spike

The spike does not integrate with the full rule engine. It can use a minimal static scanner that only detects whether changed `.ets` files contain `List(` or `Swiper(` and the required ID strings:

- `List(` plus `list_001` enables `LIST-001`.
- `Swiper(` plus `swiper_001` enables `SWIPER-001` and `SWIPER-002`.

If a component is present but its required ID is missing, the spike should create a blocked rule result:

```json
{
  "ruleId": "LIST-001",
  "result": "blocked",
  "reason": "List component was detected but required test id list_001 was missing."
}
```

This scanner is deliberately narrow. A later production design can replace it with the existing rule engine and official linter signals.

## Execution Flow

1. Cloud service creates a pending spike task with artifact URL, rules, IDs, and profiles.
2. Local runner polls the cloud service.
3. Cloud service atomically assigns one pending task to that runner.
4. Runner downloads and unpacks the artifact.
5. Runner validates local tools and emulator profiles.
6. Runner builds the app through the configured Hvigor command.
7. Runner starts one emulator profile at a time.
8. Runner installs and launches the app.
9. Runner executes the fixed Hypium suite for the requested rules.
10. Runner records measurements, screenshots, and logs.
11. Runner repeats for remaining profiles.
12. Runner uploads JSON result and artifacts.
13. Cloud service marks the task completed, partial, failed, or blocked.

## Acceptance Criteria

The spike is successful when:

- A cloud task can be created for `LIST-001`, `SWIPER-001`, and `SWIPER-002`.
- The local runner claims at most one task at a time.
- The runner can execute at least one emulator profile and upload a structured result.
- When multiple profiles are available, the runner can compare List and Swiper measurements across profiles.
- Missing component IDs produce deterministic `blocked` results.
- Build, install, launch, and test failures include logs and screenshots where available.
- No UI test result is written into the normal scoring flow.

## Risks And Mitigations

- Emulator availability may differ by OS, API version, and DevEco Studio version.
  - Mitigation: treat profile availability as runner capability and allow `partial` results for the spike.
- Tablet or 2in1 local emulators may not be available in the installed environment.
  - Mitigation: start with phone and one wider custom profile if possible; do not claim full verdict without enough profiles.
- Hypium scripts may be brittle without stable IDs.
  - Mitigation: require the fixed ID contract and mark missing IDs as `blocked`.
- Cloud-to-local callbacks can race if multiple runners are installed.
  - Mitigation: cloud task claim must be atomic, and each runner must set `maxConcurrency: 1`.
- Long-running emulators can leave stale state.
  - Mitigation: runner cleans temporary workspaces and resets app state between profiles.

## Future Work

- Add `GRID-001`, `TABS-*`, `SIDEBAR-*`, `GRIDROW-001`, `GRIDCOL-001`, `FLEX-001`, and `WATERFLOW-001`.
- Replace the spike scanner with rule-engine generated `uiTestPlan`.
- Add dashboard display for UI test evidence.
- Add AGC cloud testing as an alternative runner backend.
- Add Web rules after the pure ArkUI component path is stable.
