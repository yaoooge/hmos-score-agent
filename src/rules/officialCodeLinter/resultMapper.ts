import fs from "node:fs";
import path from "node:path";
import type { OfficialLinterFinding, RuleAuditResult } from "../../types.js";

export interface OfficialCodeLinterMappingInput {
  findings: OfficialLinterFinding[];
  workspaceDir: string;
  hasPatch: boolean;
  changedFiles: string[];
}

export interface OfficialCodeLinterMappingResult {
  effectiveFindings: OfficialLinterFinding[];
  ruleResults: RuleAuditResult[];
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveExistingPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function normalizeOfficialLinterPath(filePath: string, workspaceDir: string): string {
  const workspace = toPosixPath(resolveExistingPath(workspaceDir)).replace(/\/+$/, "");
  let normalized = toPosixPath(filePath);
  if (path.isAbsolute(filePath)) {
    normalized = toPosixPath(resolveExistingPath(filePath));
  }
  if (normalized === workspace) {
    normalized = "";
  } else if (normalized.startsWith(`${workspace}/`)) {
    normalized = normalized.slice(workspace.length + 1);
  }
  normalized = normalized.replace(/^workspace\//, "").replace(/^generated\//, "").replace(/^\.\//, "");
  return normalized;
}

function ruleSourceFrom(ruleId: string): RuleAuditResult["rule_source"] {
  if (ruleId.startsWith("@security/")) {
    return "forbidden_pattern";
  }
  return "should_rule";
}

function lineColumnText(finding: OfficialLinterFinding): string {
  if (finding.line === undefined) {
    return "";
  }
  if (finding.column === undefined) {
    return `:${finding.line}`;
  }
  return `:${finding.line}:${finding.column}`;
}

function dedupeFindings(findings: OfficialLinterFinding[]): OfficialLinterFinding[] {
  const seen = new Set<string>();
  const results: OfficialLinterFinding[] = [];
  for (const finding of findings) {
    const key = [
      finding.rule_id,
      finding.file,
      String(finding.line ?? ""),
      String(finding.column ?? ""),
      finding.message,
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(finding);
  }
  return results;
}

function aggregateRuleResults(findings: OfficialLinterFinding[]): RuleAuditResult[] {
  const groups = new Map<string, OfficialLinterFinding[]>();
  for (const finding of findings) {
    groups.set(finding.rule_id, [...(groups.get(finding.rule_id) ?? []), finding]);
  }

  return Array.from(groups.entries()).map(([ruleId, group]) => {
    const locations = group.slice(0, 5).map((finding) => `${finding.file}${lineColumnText(finding)}`);
    const extraCount = group.length - locations.length;
    const conclusion =
      `官方 Code Linter ${ruleId} 命中 ${group.length} 处：${locations.join("；")}` +
      `${extraCount > 0 ? `；另有 ${extraCount} 处同类问题。` : ""}` +
      `。${group[0]?.message ? `示例：${group[0].message}` : ""}`;
    return {
      rule_id: `OFFICIAL-LINTER:${ruleId}`,
      rule_summary: `官方 Code Linter：${ruleId}`,
      rule_source: ruleSourceFrom(ruleId),
      result: "不满足",
      conclusion,
    };
  });
}

export function mapOfficialCodeLinterFindings(
  input: OfficialCodeLinterMappingInput,
): OfficialCodeLinterMappingResult {
  const changedFiles = new Set(
    input.changedFiles.map((file) => normalizeOfficialLinterPath(file, input.workspaceDir)),
  );
  const shouldFilterByChangedFiles = input.hasPatch === true && changedFiles.size > 0;
  const normalizedFindings = input.findings.map((finding) => ({
    ...finding,
    file: normalizeOfficialLinterPath(finding.file, input.workspaceDir),
  }));
  const effectiveFindings = dedupeFindings(
    normalizedFindings.filter(
      (finding) => !shouldFilterByChangedFiles || changedFiles.has(finding.file),
    ),
  );

  return {
    effectiveFindings,
    ruleResults: aggregateRuleResults(effectiveFindings),
  };
}
