import * as path from "node:path";
import { resolveConfig, MOBILE_VIEWPORT, type AgentConfig } from "./config.js";
import { ExplorerAgent } from "./agent.js";

const args = process.argv.slice(2);

const overrides: Partial<AgentConfig> = {};

if (args.includes("--mobile")) {
  overrides.viewport = MOBILE_VIEWPORT;
  overrides.agentName = "explorer-mobile";
}

if (args.includes("--headed")) {
  overrides.headed = true;
}

const turnsFlag = args.find((a) => a.startsWith("--turns="));
if (turnsFlag) {
  overrides.maxTurns = parseInt(turnsFlag.split("=")[1], 10);
}

const urlFlag = args.find((a) => a.startsWith("--url="));
if (urlFlag) {
  overrides.baseUrl = urlFlag.split("=")[1];
}

const modelFlag = args.find((a) => a.startsWith("--model="));
if (modelFlag) {
  overrides.model = modelFlag.split("=")[1];
}

// Resolve paths relative to the agents package root
const pkgRoot = path.resolve(import.meta.dirname, "..");
overrides.screenshotDir = path.join(pkgRoot, "screenshots");
overrides.logDir = path.join(pkgRoot, "logs");

const config = resolveConfig(overrides);

console.log("LAMO Autonomous Testing Agent");
console.log("==============================");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is required");
  process.exit(1);
}

const agent = new ExplorerAgent(config);
agent.start().catch((err) => {
  console.error("Agent crashed:", err);
  process.exit(1);
});
