import fs from "node:fs/promises";
import path from "node:path";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { AgentClient } from "../agent/agentClient.js";
import {
  buildFallbackConstraintSummary,
  parseConstraintSummary,
} from "../agent/taskUnderstanding.js";
import type { ArtifactStore } from "../io/artifactStore.js";
import { generateCasePatch } from "../io/patchGenerator.js";
import { loadCaseConstraintRules } from "../rules/caseConstraintLoader.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";
import type {
  CaseRuleDefinition,
  ConstraintSummary,
  PatchSummary,
  ProjectStructureSummary,
  TaskUnderstandingAgentInput,
} from "../types.js";

type TaskUnderstandingDeps = {
  agentClient?: Partial<Pick<AgentClient, "understandTask">>;
  artifactStore?: ArtifactStore;
  logger?: {
    info(message: string): Promise<void>;
    warn(message: string): Promise<void>;
  };
};

const ignoredDirectoryNames = new Set([
  ".git",
  ".hvigor",
  ".idea",
  ".vscode",
  "build",
  "dist",
  "node_modules",
  "oh_modules",
]);
const representativeExtensions = new Set([
  ".ets",
  ".ts",
  ".js",
  ".json",
  ".json5",
  ".yaml",
  ".yml",
  ".md",
]);

function isDeps(
  value: TaskUnderstandingDeps | LangGraphRunnableConfig | undefined,
): value is TaskUnderstandingDeps {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "agentClient" in value || "artifactStore" in value || "logger" in value;
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

async function collectProjectStructure(rootPath: string): Promise<ProjectStructureSummary> {
  const files: string[] = [];
  const topLevelEntries: string[] = [];
  let omittedFileCount = 0;
  const maxFiles = 500;
  const maxDepth = 8;

  async function visit(dirPath: string, depth: number): Promise<void> {
    if (depth > maxDepth || files.length >= maxFiles) {
      omittedFileCount += 1;
      return;
    }

    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (depth === 0) {
        topLevelEntries.push(entry.name);
      }
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (files.length >= maxFiles) {
        omittedFileCount += 1;
        continue;
      }
      files.push(normalizeRelativePath(path.relative(rootPath, absolutePath)));
    }
  }

  await visit(rootPath, 0);

  const modulePaths = unique(
    files
      .filter((file) => file.endsWith("/src/main/module.json5") || file === "src/main/module.json5")
      .map((file) => {
        const marker = "/src/main/module.json5";
        if (file.endsWith(marker)) {
          return file.slice(0, -marker.length);
        }
        return ".";
      }),
  );
  const representativeFiles = files
    .filter((file) => representativeExtensions.has(path.extname(file)))
    .slice(0, 80);
  const implementationHints = [
    modulePaths.length > 0 ? `HarmonyOS 模块: ${modulePaths.join(", ")}` : "",
    files.some((file) => file.endsWith(".ets")) ? "技术栈: ArkTS/ETS 页面与组件实现" : "",
    files.some((file) => file.includes("/viewmodels/"))
      ? "分层: 存在 viewmodels 目录，需保持状态管理分层"
      : "",
    files.some((file) => file.includes("/components/"))
      ? "分层: 存在 components 目录，需复用组件边界"
      : "",
    files.some((file) => file.includes("/resources/"))
      ? "资源: 存在 resources 目录，需遵循资源引用约束"
      : "",
  ].filter(Boolean);

  return {
    rootPath,
    topLevelEntries: unique(topLevelEntries).sort(),
    modulePaths,
    representativeFiles,
    implementationHints,
    omittedFileCount,
  };
}

function inferChangedFileFromDiffLine(line: string): string | undefined {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  if (!match) {
    return undefined;
  }
  return match[2];
}

function inferChangedFileFromMarkerLine(line: string): string | undefined {
  const match = /^\+\+\+ b\/(.+)$/.exec(line);
  if (!match || match[1] === "/dev/null") {
    return undefined;
  }
  return match[1];
}

function summarizePatch(patchText: string): PatchSummary {
  if (!patchText.trim()) {
    return {
      hasPatch: false,
      changedFiles: [],
      affectedRoots: [],
      addedLines: 0,
      deletedLines: 0,
      changeTypes: [],
      intrusionLevel: "none",
      rawPatchLength: 0,
    };
  }

  const changedFiles: string[] = [];
  const changeTypes = new Set<string>();
  let addedLines = 0;
  let deletedLines = 0;

  for (const line of patchText.split(/\r?\n/)) {
    const fromDiff = inferChangedFileFromDiffLine(line);
    const fromMarker = inferChangedFileFromMarkerLine(line);
    if (fromDiff) {
      changedFiles.push(fromDiff);
    }
    if (fromMarker) {
      changedFiles.push(fromMarker);
    }

    if (line === "new file mode" || line.startsWith("new file mode ")) {
      changeTypes.add("added_file");
    } else if (line === "deleted file mode" || line.startsWith("deleted file mode ")) {
      changeTypes.add("deleted_file");
    } else if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      changeTypes.add("renamed_file");
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletedLines += 1;
    }
  }

  if (addedLines > 0 || deletedLines > 0) {
    changeTypes.add("modified");
  }
  const files = unique(changedFiles);
  const affectedRoots = unique(files.map((file) => file.split("/")[0] ?? file));
  const changedLineCount = addedLines + deletedLines;
  const intrusionLevel =
    files.length === 0
      ? "none"
      : files.length <= 2 && changedLineCount <= 80
        ? "low"
        : files.length <= 8 && changedLineCount <= 300
          ? "medium"
          : "high";

  return {
    hasPatch: true,
    changedFiles: files,
    affectedRoots,
    addedLines,
    deletedLines,
    changeTypes: Array.from(changeTypes),
    intrusionLevel,
    rawPatchLength: patchText.length,
  };
}

async function readPatchSummary(patchPath?: string): Promise<PatchSummary> {
  if (!patchPath) {
    return summarizePatch("");
  }
  const patchText = await fs.readFile(patchPath, "utf-8").catch(() => "");
  return summarizePatch(patchText);
}

async function understandWithAgent(
  input: TaskUnderstandingAgentInput,
  deps: TaskUnderstandingDeps,
): Promise<ConstraintSummary> {
  if (!deps.agentClient?.understandTask) {
    await deps.logger?.warn("任务理解 agent 跳过 reason=未配置 task understanding 能力");
    return buildFallbackConstraintSummary(input);
  }

  try {
    await deps.logger?.info("任务理解 agent 调用开始");
    const rawOutputText = await deps.agentClient.understandTask(input);
    const summary = parseConstraintSummary(rawOutputText);
    await deps.logger?.info("任务理解 agent 调用完成");
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.warn(`任务理解 agent 输出无效，已回退本地摘要 reason=${message}`);
    return buildFallbackConstraintSummary(input);
  }
}

async function persistConstraintSummary(
  state: ScoreGraphState,
  deps: TaskUnderstandingDeps,
  summary: ConstraintSummary,
): Promise<void> {
  if (!deps.artifactStore || !state.caseDir) {
    return;
  }
  await deps.artifactStore.writeJson(
    state.caseDir,
    "intermediate/constraint-summary.json",
    summary,
  );
}

async function ensureEffectivePatchPath(
  state: ScoreGraphState,
  deps: TaskUnderstandingDeps,
): Promise<string | undefined> {
  if (state.caseInput.patchPath) {
    return state.caseInput.patchPath;
  }
  if (!deps.artifactStore || !state.caseDir) {
    return undefined;
  }

  const caseRoot = path.dirname(state.caseInput.originalProjectPath);
  const outputPath = path.join(state.caseDir, "intermediate", "generated.patch");
  return generateCasePatch(caseRoot, outputPath);
}

async function persistCaseRuleDefinitions(
  state: ScoreGraphState,
  deps: TaskUnderstandingDeps,
  caseRuleDefinitions: CaseRuleDefinition[],
): Promise<void> {
  if (!deps.artifactStore || !state.caseDir) {
    return;
  }

  await deps.artifactStore.writeJson(
    state.caseDir,
    "intermediate/case-rule-definitions.json",
    caseRuleDefinitions,
  );
}

export async function taskUnderstandingNode(
  state: ScoreGraphState,
  depsOrConfig: TaskUnderstandingDeps | LangGraphRunnableConfig = {},
  maybeConfig?: LangGraphRunnableConfig,
): Promise<Partial<ScoreGraphState>> {
  const deps = isDeps(depsOrConfig) ? depsOrConfig : {};
  const config = isDeps(depsOrConfig) ? maybeConfig : depsOrConfig;
  emitNodeStarted("taskUnderstandingNode", config);

  try {
    const projectStructure = await collectProjectStructure(state.caseInput.originalProjectPath);
    const effectivePatchPath = await ensureEffectivePatchPath(state, deps);
    const patchSummary = await readPatchSummary(effectivePatchPath);
    const caseRuleDefinitions = await loadCaseConstraintRules(state.caseInput);
    const agentInput: TaskUnderstandingAgentInput = {
      caseId: state.caseInput.caseId,
      promptText: state.caseInput.promptText,
      originalProjectPath: state.caseInput.originalProjectPath,
      generatedProjectPath: state.caseInput.generatedProjectPath,
      projectStructure,
      patchSummary,
    };
    const constraintSummary = await understandWithAgent(agentInput, deps);
    await persistConstraintSummary(state, deps, constraintSummary);
    await persistCaseRuleDefinitions(state, deps, caseRuleDefinitions);

    return {
      effectivePatchPath,
      caseRuleDefinitions,
      constraintSummary,
    };
  } catch (error) {
    emitNodeFailed("taskUnderstandingNode", error, config);
    throw error;
  }
}
