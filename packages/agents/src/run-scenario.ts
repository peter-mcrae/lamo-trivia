import * as path from "node:path";
import { resolveConfig, MOBILE_VIEWPORT, type AgentConfig } from "./config.js";
import { ExplorerAgent } from "./agent.js";
import { getScenario, listScenarios } from "./scenarios.js";

const args = process.argv.slice(2);
const scenarioName = args[0];

if (!scenarioName || scenarioName === "--list") {
  console.log("LAMO Autonomous Testing Agent - Scenario Runner");
  console.log("================================================\n");
  console.log("Usage: npx tsx src/run-scenario.ts <scenario-name> [options]\n");
  console.log("Available scenarios:");
  for (const name of listScenarios()) {
    const s = getScenario(name)!;
    console.log(`  ${name.padEnd(25)} ${s.description} (${s.suggestedTurns} turns)`);
  }
  console.log("\nOptions:");
  console.log("  --headed        Run with visible browser");
  console.log("  --turns=N       Override turn count");
  console.log("  --url=URL       Override base URL");
  console.log("  --model=MODEL   Override Claude model");
  process.exit(0);
}

const scenario = getScenario(scenarioName);
if (!scenario) {
  console.error(`Unknown scenario: "${scenarioName}"`);
  console.error(`Run with --list to see available scenarios`);
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is required");
  process.exit(1);
}

if (scenario.requiresAuth && !process.env.LAMO_AUTH_TOKEN) {
  console.warn(
    `Warning: Scenario "${scenario.name}" requires auth but LAMO_AUTH_TOKEN is not set.`,
  );
  console.warn("The agent may not be able to access authenticated features.\n");
}

const overrides: Partial<AgentConfig> = {
  agentName: `scenario-${scenarioName}`,
  maxTurns: scenario.suggestedTurns,
};

// Apply mobile viewport for the mobile scenario
if (scenarioName === "mobile") {
  overrides.viewport = MOBILE_VIEWPORT;
}

if (args.includes("--headed")) overrides.headed = true;

const turnsFlag = args.find((a) => a.startsWith("--turns="));
if (turnsFlag) overrides.maxTurns = parseInt(turnsFlag.split("=")[1], 10);

const urlFlag = args.find((a) => a.startsWith("--url="));
if (urlFlag) overrides.baseUrl = urlFlag.split("=")[1];

const modelFlag = args.find((a) => a.startsWith("--model="));
if (modelFlag) overrides.model = modelFlag.split("=")[1];

// Resolve paths relative to the agents package root
const pkgRoot = path.resolve(import.meta.dirname, "..");
overrides.screenshotDir = path.join(pkgRoot, "screenshots");
overrides.logDir = path.join(pkgRoot, "logs");

const config = resolveConfig(overrides);

console.log("LAMO Autonomous Testing Agent - Scenario Runner");
console.log("================================================");
console.log(`Scenario: ${scenario.name}`);
console.log(`Description: ${scenario.description}`);
console.log(`Auth required: ${scenario.requiresAuth}\n`);

const agent = new ExplorerAgent(config, scenario);
agent.start().catch((err) => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
