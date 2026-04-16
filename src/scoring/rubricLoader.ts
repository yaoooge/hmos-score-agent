import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { TaskType } from "../types.js";

// `rubric.yaml` 在运行期会被归一化成这些轻量结构，供 scoring engine 直接消费。
export interface LoadedRubricItem {
  name: string;
  weight: number;
}

export interface LoadedRubricDimension {
  name: string;
  weight: number;
  items: LoadedRubricItem[];
}

export interface LoadedRubricHardGate {
  id: "G1" | "G2" | "G3" | "G4";
  scoreCap: number;
}

export interface LoadedRubric {
  taskType: TaskType;
  evaluationMode: string;
  dimensions: LoadedRubricDimension[];
  hardGates: LoadedRubricHardGate[];
  reviewRules: {
    scoreBands: Array<{ min: number; max: number }>;
  };
}

type RubricDoc = {
  modes?: { default_evaluation_mode?: string };
  hard_gates?: Array<{ id: LoadedRubricHardGate["id"]; score_cap: number; applies_to?: TaskType[] }>;
  human_review_rules?: { force_review_when?: string[] };
  task_templates?: Record<
    TaskType,
    {
      dimensions?: Array<{ name: string; weight: number; items?: Array<{ name: string; weight: number }> }>;
    }
  >;
};

function parseScoreBands(forceReviewRules: string[] | undefined): Array<{ min: number; max: number }> {
  // 目前只抽取文档中显式出现的临界分段，保持实现简单且可解释。
  return (forceReviewRules ?? [])
    .flatMap((rule) => Array.from(rule.matchAll(/(\d+)-(\d+)/g)))
    .map((match) => ({ min: Number(match[1]), max: Number(match[2]) }));
}

export async function loadRubricForTaskType(taskType: TaskType, referenceRoot: string): Promise<LoadedRubric> {
  // 评分模板的唯一入口，后续扩展新 task type 或新字段时优先改这里。
  const rubricPath = path.join(referenceRoot, "rubric.yaml");
  const rubricText = await fs.readFile(rubricPath, "utf-8");
  const doc = (yaml.load(rubricText) as RubricDoc | undefined) ?? {};
  const template = doc.task_templates?.[taskType];

  if (!template?.dimensions?.length) {
    throw new Error(`Rubric template not found for task type: ${taskType}`);
  }

  return {
    taskType,
    evaluationMode: doc.modes?.default_evaluation_mode ?? "auto_precheck_with_human_review",
    dimensions: template.dimensions.map((dimension) => ({
      name: dimension.name,
      weight: dimension.weight,
      items: (dimension.items ?? []).map((item) => ({
        name: item.name,
        weight: item.weight,
      })),
    })),
    hardGates: (doc.hard_gates ?? [])
      .filter((gate) => (gate.applies_to ?? []).includes(taskType))
      .map((gate) => ({
        id: gate.id,
        scoreCap: gate.score_cap,
      })),
    reviewRules: {
      scoreBands: parseScoreBands(doc.human_review_rules?.force_review_when),
    },
  };
}
