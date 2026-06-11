import type { ArkExpressionFact, ArkFactsIndex } from "../../arkfacts/index.js";
import type { ArkuiComponentInstance, ArkuiStaticScanIndex } from "./staticScanner.js";

export function buildArkuiStaticScanIndexFromArkFacts(facts: ArkFactsIndex): ArkuiStaticScanIndex {
  const componentInstances = facts.components.map((component, index): ArkuiComponentInstance => {
    const constructorProperties = component.attributes.filter(
      (attribute) => attribute.source === "constructor",
    );
    const chainedProperties = component.attributes.filter(
      (attribute) => attribute.source !== "constructor",
    );
    return {
      component: component.name,
      filePath: component.filePath,
      line: component.line ?? 1,
      startIndex: index,
      endIndex: index,
      argumentText: renderConstructorArgument(constructorProperties),
      properties: chainedProperties.map((attribute) => ({
        name: attribute.name,
        argumentText: renderAttributeExpression(attribute),
        line: attribute.line ?? component.line ?? 1,
        usesBreakpoint: expressionUsesBreakpoint(attribute.expr) || component.stateRefs.length > 0,
      })),
    };
  });

  const componentCountByFile = new Map<string, number>();
  for (const instance of componentInstances) {
    componentCountByFile.set(
      instance.filePath,
      (componentCountByFile.get(instance.filePath) ?? 0) + 1,
    );
  }

  return {
    componentInstances,
    constants: {},
    files: [...componentCountByFile].map(([relativePath, componentCount]) => ({
      relativePath,
      componentCount,
    })),
  };
}

function renderConstructorArgument(
  attributes: Array<{ name: string; expr?: ArkExpressionFact }>,
): string {
  if (attributes.length === 0) {
    return "";
  }
  return `{ ${attributes.map((attribute) => `${attribute.name}: ${renderAttributeExpression(attribute)}`).join(", ")} }`;
}

function renderAttributeExpression(attribute: { name: string; expr?: ArkExpressionFact }): string {
  return attribute.expr ? renderExpression(attribute.expr) : `__arkAnalyzerOpaque(${attribute.name})`;
}

function renderExpression(expression: ArkExpressionFact | undefined): string {
  if (!expression) {
    return "";
  }
  if (expression.kind === "literal") {
    if (typeof expression.value === "string") {
      return expression.unit ? `${expression.value}${expression.unit}` : JSON.stringify(expression.value);
    }
    return `${expression.value}${expression.unit ?? ""}`;
  }
  if (expression.kind === "enum") {
    return expression.name;
  }
  if (expression.kind === "resource") {
    return `$r('${expression.name}')`;
  }
  if (expression.kind === "symbol") {
    return expression.name;
  }
  if (expression.kind === "array") {
    return `[${expression.items.map(renderExpression).join(", ")}]`;
  }
  if (expression.kind === "object") {
    return `{ ${Object.entries(expression.properties)
      .map(([key, value]) => `${key}: ${renderExpression(value)}`)
      .join(", ")} }`;
  }
  if (expression.kind === "call") {
    return `${expression.callee}(${expression.args.map(renderExpression).join(", ")})`;
  }
  if (expression.kind === "breakpointValue") {
    return `{ ${Object.entries(expression.values)
      .map(([key, value]) => `${key}: ${renderExpression(value)}`)
      .join(", ")} }`;
  }
  return expression.raw ?? "";
}

function expressionUsesBreakpoint(expression: ArkExpressionFact | undefined): boolean {
  if (!expression) {
    return false;
  }
  if (expression.kind === "breakpointValue") {
    return true;
  }
  if (expression.kind === "symbol") {
    return /breakpoint|isLargeScreen|isMediumScreen|isSmallScreen/i.test(expression.name);
  }
  if (expression.kind === "object") {
    return Object.keys(expression.properties).some((key) => ["sm", "md", "lg", "xl"].includes(key));
  }
  return false;
}
