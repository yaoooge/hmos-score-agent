import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type {
  HvigorBuildCheckModuleResult,
  HvigorBuildCheckStatus,
  HvigorBuildCheckSummary,
} from "../../types.js";

type HvigorModuleBuildTarget = "hap" | "har" | "hsp" | "unknown";

export interface HvigorBuildCheckInput {
  enabled: boolean;
  hvigorRunDir?: string;
  workspaceDir?: string;
  changedFiles: string[];
  timeoutMs: number;
}

type CommandResult = {
  status: "success" | "failed" | "timeout";
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs: number;
};

const outputExcerptBytes = 64 * 1024;

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/").replace(/\\/g, "/");
}

function excerptOutput(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const buffer = Buffer.from(value, "utf-8");
  if (buffer.length <= outputExcerptBytes) {
    return value;
  }
  return buffer.subarray(buffer.length - outputExcerptBytes).toString("utf-8");
}

function makeEmptySummary(input: {
  enabled: boolean;
  status: HvigorBuildCheckStatus;
  hvigorRunDir?: string;
  diagnostics?: string;
  durationMs: number;
  hardGateTriggered?: boolean;
  scoreCap?: number;
  checkedModules?: string[];
  moduleResults?: HvigorBuildCheckModuleResult[];
}): HvigorBuildCheckSummary {
  return {
    enabled: input.enabled,
    status: input.status,
    hvigorRunDir: input.hvigorRunDir,
    checkedModules: input.checkedModules ?? [],
    moduleResults: input.moduleResults ?? [],
    hardGateTriggered: input.hardGateTriggered ?? false,
    scoreCap: input.scoreCap,
    diagnostics: input.diagnostics,
    durationMs: input.durationMs,
    cleanup: {
      attempted: false,
      removedPaths: [],
      failedPaths: [],
    },
  };
}

export function detectChangedHarmonyModules(changedFiles: string[]): string[] {
  const modules = new Set<string>();
  for (const changedFile of changedFiles) {
    const segments = toPosixPath(changedFile).split("/").filter(Boolean);
    const srcIndex = segments.findIndex(
      (segment, index) => segment === "src" && segments[index + 1] === "main",
    );
    if (srcIndex < 0) {
      continue;
    }
    modules.add(srcIndex === 0 ? "." : segments.slice(0, srcIndex).join("/"));
  }
  return Array.from(modules).sort((left, right) => left.localeCompare(right));
}

async function readFirstExistingFile(paths: string[]): Promise<string | undefined> {
  for (const filePath of paths) {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function detectHvigorModuleBuildTarget(
  workspaceDir: string,
  modulePath: string,
): Promise<HvigorModuleBuildTarget> {
  const moduleRoot = modulePath === "." ? workspaceDir : path.join(workspaceDir, modulePath);
  const content = await readFirstExistingFile([
    path.join(moduleRoot, "hvigorfile.ts"),
    path.join(moduleRoot, "hvigorfile.js"),
  ]);
  if (!content) {
    return "unknown";
  }
  if (/\bhapTasks\b/.test(content)) {
    return "hap";
  }
  if (/\bharTasks\b/.test(content)) {
    return "har";
  }
  if (/\bhspTasks\b/.test(content)) {
    return "hsp";
  }
  return "unknown";
}

function commandForTarget(target: HvigorModuleBuildTarget): HvigorBuildCheckModuleResult["command"] | undefined {
  if (target === "hap") {
    return "assembleHap";
  }
  if (target === "har") {
    return "assembleHar";
  }
  if (target === "hsp") {
    return "assembleHsp";
  }
  return undefined;
}

function moduleNameFromPath(modulePath: string): string {
  if (modulePath === ".") {
    return "entry";
  }
  const segments = modulePath.split("/").filter(Boolean);
  return segments.at(-1) ?? modulePath;
}

async function findHvigorw(hvigorRunDir: string): Promise<string | undefined> {
  const candidates = [path.join(hvigorRunDir, "hvigorw"), path.join(hvigorRunDir, "bin", "hvigorw")];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<CommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    const finish = (result: Omit<CommandResult, "durationMs">) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        stdout: excerptOutput(result.stdout) ?? "",
        stderr: excerptOutput(result.stderr) ?? "",
        durationMs: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      finish({
        status: "failed",
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: `${Buffer.concat(stderrChunks).toString("utf-8")}\n${error.message}`.trim(),
      });
    });
    child.on("close", (code) => {
      finish({
        status: timedOut ? "timeout" : code === 0 ? "success" : "failed",
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? undefined,
      });
    });
  });
}

function isInsideWorkspace(workspaceDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(workspaceDir), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function cleanupBuildArtifacts(
  workspaceDir: string,
  modulePaths: string[],
): Promise<HvigorBuildCheckSummary["cleanup"]> {
  const candidates = [
    path.join(workspaceDir, ".hvigor"),
    path.join(workspaceDir, "build"),
    path.join(workspaceDir, "oh_modules"),
    ...modulePaths.flatMap((modulePath) => {
      const moduleRoot = modulePath === "." ? workspaceDir : path.join(workspaceDir, modulePath);
      return [
        path.join(moduleRoot, "build"),
        path.join(moduleRoot, "oh_modules"),
        path.join(moduleRoot, ".preview"),
      ];
    }),
  ];
  const removedPaths: string[] = [];
  const failedPaths: Array<{ path: string; reason: string }> = [];
  for (const candidate of Array.from(new Set(candidates))) {
    const relativePath = toPosixPath(path.relative(workspaceDir, candidate)) || ".";
    if (!isInsideWorkspace(workspaceDir, candidate)) {
      failedPaths.push({ path: relativePath, reason: "cleanup target escapes workspace" });
      continue;
    }
    try {
      await fs.rm(candidate, { recursive: true, force: true });
      removedPaths.push(relativePath);
    } catch (error) {
      failedPaths.push({
        path: relativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    attempted: true,
    removedPaths,
    failedPaths,
  };
}

function commandArgsForModule(input: {
  command: HvigorBuildCheckModuleResult["command"];
  moduleName: string;
}): string[] {
  return [
    input.command,
    "--mode",
    "module",
    "-p",
    `module=${input.moduleName}@default`,
    "-p",
    "product=default",
    "--no-daemon",
  ];
}

export async function runHvigorBuildCheck(
  input: HvigorBuildCheckInput,
): Promise<HvigorBuildCheckSummary> {
  const startedAt = Date.now();
  if (!input.enabled) {
    return makeEmptySummary({
      enabled: false,
      status: "not_enabled",
      durationMs: Date.now() - startedAt,
      diagnostics: "hvigor build check is disabled because official Code Linter is disabled",
    });
  }
  if (!input.workspaceDir) {
    return makeEmptySummary({
      enabled: true,
      status: "tool_unavailable",
      hvigorRunDir: input.hvigorRunDir,
      durationMs: Date.now() - startedAt,
      diagnostics: "hvigor build check workspace is unavailable",
      hardGateTriggered: true,
      scoreCap: 59,
    });
  }

  const modules = detectChangedHarmonyModules(input.changedFiles);
  if (modules.length === 0) {
    const summary = makeEmptySummary({
      enabled: true,
      status: "skipped",
      hvigorRunDir: input.hvigorRunDir,
      checkedModules: [],
      durationMs: Date.now() - startedAt,
      diagnostics: "no changed HarmonyOS module under src/main",
    });
    summary.cleanup = await cleanupBuildArtifacts(input.workspaceDir, []);
    return summary;
  }

  if (!input.hvigorRunDir) {
    const summary = makeEmptySummary({
      enabled: true,
      status: "tool_unavailable",
      checkedModules: modules,
      durationMs: Date.now() - startedAt,
      diagnostics: "hvigor run directory is unavailable",
      hardGateTriggered: true,
      scoreCap: 59,
    });
    summary.cleanup = await cleanupBuildArtifacts(input.workspaceDir, modules);
    return summary;
  }

  const hvigorw = await findHvigorw(input.hvigorRunDir);
  if (!hvigorw) {
    const summary = makeEmptySummary({
      enabled: true,
      status: "tool_unavailable",
      hvigorRunDir: input.hvigorRunDir,
      checkedModules: modules,
      durationMs: Date.now() - startedAt,
      diagnostics: "hvigorw is unavailable",
      hardGateTriggered: true,
      scoreCap: 59,
    });
    summary.cleanup = await cleanupBuildArtifacts(input.workspaceDir, modules);
    return summary;
  }

  const versionResult = await runCommand({
    command: hvigorw,
    args: ["--version"],
    cwd: input.workspaceDir,
    timeoutMs: input.timeoutMs,
  });
  if (versionResult.status !== "success") {
    const status = versionResult.status === "timeout" ? "timeout" : "tool_unavailable";
    const summary = makeEmptySummary({
      enabled: true,
      status,
      hvigorRunDir: input.hvigorRunDir,
      checkedModules: modules,
      durationMs: Date.now() - startedAt,
      diagnostics: `hvigorw --version ${versionResult.status}`,
      hardGateTriggered: true,
      scoreCap: 59,
    });
    summary.cleanup = await cleanupBuildArtifacts(input.workspaceDir, modules);
    return summary;
  }

  const moduleResults: HvigorBuildCheckModuleResult[] = [];
  for (const modulePath of modules) {
    const target = await detectHvigorModuleBuildTarget(input.workspaceDir, modulePath);
    const command = commandForTarget(target);
    const moduleName = moduleNameFromPath(modulePath);
    if (!command) {
      moduleResults.push({
        modulePath,
        moduleName,
        command: "assembleHar",
        status: "skipped",
        durationMs: 0,
        diagnostics: "module hvigorfile does not declare hapTasks, harTasks, or hspTasks",
      });
      continue;
    }
    const commandResult = await runCommand({
      command: hvigorw,
      args: commandArgsForModule({ command, moduleName }),
      cwd: input.workspaceDir,
      timeoutMs: input.timeoutMs,
    });
    moduleResults.push({
      modulePath,
      moduleName,
      command,
      status: commandResult.status,
      exitCode: commandResult.exitCode,
      durationMs: commandResult.durationMs,
      stdoutExcerpt: commandResult.stdout,
      stderrExcerpt: commandResult.stderr,
    });
  }

  const failed = moduleResults.find((result) => result.status === "failed");
  const timedOut = moduleResults.find((result) => result.status === "timeout");
  const compiled = moduleResults.filter((result) => result.status !== "skipped");
  const status: HvigorBuildCheckStatus = timedOut
    ? "timeout"
    : failed
      ? "failed"
      : compiled.length > 0
        ? "success"
        : "skipped";
  const hardGateTriggered = status === "failed" || status === "timeout";
  const summary: HvigorBuildCheckSummary = {
    enabled: true,
    status,
    hvigorRunDir: input.hvigorRunDir,
    checkedModules: modules,
    moduleResults,
    hardGateTriggered,
    scoreCap: hardGateTriggered ? 59 : undefined,
    diagnostics:
      status === "success"
        ? undefined
        : status === "skipped"
          ? "changed modules do not declare supported hvigor task types"
          : `hvigor build check ${status}`,
    durationMs: Date.now() - startedAt,
    cleanup: {
      attempted: false,
      removedPaths: [],
      failedPaths: [],
    },
  };
  summary.cleanup = await cleanupBuildArtifacts(input.workspaceDir, modules);
  summary.durationMs = Date.now() - startedAt;
  return summary;
}
