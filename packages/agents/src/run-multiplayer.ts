import * as path from "node:path";
import { resolveConfig, type AgentConfig } from "./config.js";
import { MultiplayerAgent, type GameType } from "./multiplayer-agent.js";
import { Coordinator } from "./coordinator.js";

const args = process.argv.slice(2);
const gameType = (args[0] as GameType) || "trivia";

if (!["trivia", "hunt"].includes(gameType)) {
  console.log("LAMO Autonomous Testing Agent - Multiplayer Runner");
  console.log("===================================================\n");
  console.log("Usage: npx tsx src/run-multiplayer.ts <game-type> [options]\n");
  console.log("Game types:");
  console.log("  trivia    Two agents create and play a trivia game together");
  console.log("  hunt      Two agents create and play a scavenger hunt together");
  console.log("\nOptions:");
  console.log("  --headed        Run with visible browsers");
  console.log("  --turns=N       Override turn count per agent");
  console.log("  --url=URL       Override base URL");
  console.log("  --model=MODEL   Override Claude model");
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is required");
  process.exit(1);
}

if (gameType === "hunt" && !process.env.LAMO_AUTH_TOKEN) {
  console.warn("Warning: Hunt game type requires auth but LAMO_AUTH_TOKEN is not set.\n");
}

const pkgRoot = path.resolve(import.meta.dirname, "..");
const baseOverrides: Partial<AgentConfig> = {
  screenshotDir: path.join(pkgRoot, "screenshots"),
  logDir: path.join(pkgRoot, "logs"),
  maxTurns: 50,
};

if (args.includes("--headed")) baseOverrides.headed = true;

const turnsFlag = args.find((a) => a.startsWith("--turns="));
if (turnsFlag) baseOverrides.maxTurns = parseInt(turnsFlag.split("=")[1], 10);

const urlFlag = args.find((a) => a.startsWith("--url="));
if (urlFlag) baseOverrides.baseUrl = urlFlag.split("=")[1];

const modelFlag = args.find((a) => a.startsWith("--model="));
if (modelFlag) baseOverrides.model = modelFlag.split("=")[1];

// Create shared coordinator
const coordinator = new Coordinator(path.join(pkgRoot, "logs"));
coordinator.reset();

// Create host and joiner configs
const hostConfig = resolveConfig({ ...baseOverrides, agentName: "mp-host" });
const joinerConfig = resolveConfig({ ...baseOverrides, agentName: "mp-joiner" });

console.log("LAMO Autonomous Testing Agent - Multiplayer Runner");
console.log("===================================================");
console.log(`Game type: ${gameType}`);
console.log(`Turns per agent: ${hostConfig.maxTurns}`);
console.log("Launching host and joiner agents concurrently...\n");

const hostAgent = new MultiplayerAgent(hostConfig, "host", gameType, coordinator);
const joinerAgent = new MultiplayerAgent(joinerConfig, "joiner", gameType, coordinator);

// Run both agents concurrently
Promise.allSettled([hostAgent.start(), joinerAgent.start()]).then((results) => {
  console.log("\n===== Multiplayer Session Complete =====");
  for (const [i, result] of results.entries()) {
    const role = i === 0 ? "Host" : "Joiner";
    if (result.status === "fulfilled") {
      console.log(`${role}: Completed successfully`);
    } else {
      console.error(`${role}: Failed -`, result.reason);
    }
  }

  // Print coordination log
  const messages = coordinator.getAll();
  console.log(`\nCoordination messages: ${messages.length}`);
  for (const msg of messages) {
    console.log(`  [${msg.timestamp}] ${msg.fromAgent}: ${msg.type} ${JSON.stringify(msg.payload)}`);
  }
});
