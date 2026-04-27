# Project Opencode Runtime

This directory contains the project-owned opencode configuration for HMOS score agent.

The scoring service must not rely on user-level opencode configuration. At startup it generates `.opencode/runtime/opencode.generated.json` from `.opencode/opencode.template.json`, then runs opencode with isolated `HOME`, `XDG_*`, `OPENCODE_CONFIG`, and `OPENCODE_CONFIG_DIR` values.

Required environment variables:

- `HMOS_OPENCODE_PORT`
- `HMOS_OPENCODE_HOST`
- `HMOS_OPENCODE_PROVIDER_ID`
- `HMOS_OPENCODE_MODEL_ID`
- `HMOS_OPENCODE_MODEL_NAME`
- `HMOS_OPENCODE_BASE_URL`
- `HMOS_OPENCODE_API_KEY`
- `HMOS_OPENCODE_TIMEOUT_MS`
- `HMOS_OPENCODE_MAX_OUTPUT_BYTES`

The project-level opencode permissions are intentionally read-only. opencode may read, list, glob, and grep files in the prepared per-case sandbox. It must not edit files, run shell commands, access external directories, browse the web, ask questions, or start subagents.

Runtime state under `.opencode/runtime/` is generated and must not be committed.
