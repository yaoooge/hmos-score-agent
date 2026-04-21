import path from "node:path";
import { getRegisteredRulePacks } from "../rules/engine/rulePackRegistry.js";
import { writeRulePackYamlFiles } from "../rules/engine/rulePackYamlExporter.js";

const outputDirectory = path.resolve(process.cwd(), "reference");
const writtenFiles = await writeRulePackYamlFiles(getRegisteredRulePacks(), outputDirectory);

for (const filePath of writtenFiles) {
  console.log(`Wrote ${path.relative(process.cwd(), filePath)}`);
}
