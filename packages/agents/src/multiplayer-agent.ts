import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { AgentConfig } from "./config.js";
import type { TurnLog } from "./types.js";
import { AgentBrain } from "./brain.js";
import { executeAction, getPageText, getInteractiveElements } from "./executor.js";
import { SessionLogger } from "./logger.js";
import { Coordinator } from "./coordinator.js";
import { getPlaceholderPhotoPath, getRandomPhoto } from "./photos.js";

export type AgentRole = "host" | "joiner";
export type GameType = "trivia" | "hunt";

const HOST_INSTRUCTIONS = `You are the HOST agent in a multiplayer test session.

Your mission:
1. Create a new game (trivia or scavenger hunt depending on your start page)
2. Enter username "TestBot-Host"
3. IMPORTANT: Once in the game room, look for the game code or share URL.
   When you see text like "Game Code: XXXX" or a share link, report it in your observation.
   Include the exact code or URL in your description field prefixed with "GAME_CODE:" or "GAME_URL:".
4. Wait for the other player to join (you'll see the player count increase)
5. Once another player has joined, click "Start Game" or "Start Hunt"
6. Play through the game normally — answer questions, submit photos, etc.
7. At the end, observe the results screen

Edge cases to test as host:
- What happens if you refresh while waiting for players?
- Try the share button
- Check that the player count updates in real-time`;

const JOINER_INSTRUCTIONS = `You are the JOINER agent in a multiplayer test session.

Your mission:
1. You will be navigated to a game URL. Enter username "TestBot-Joiner"
2. Wait in the lobby for the host to start the game
3. Play through the game — answer questions, submit photos, etc.
4. At the end, observe the results screen

Edge cases to test as joiner:
- What happens if you refresh while waiting for the host to start?
- Try answering at the last second
- Submit answers quickly to test race conditions
- If it's a hunt, try submitting photos at the same time as the host`;

/**
 * A multiplayer-aware agent that coordinates with another agent
 * via the Coordinator to create and join games together.
 */
export class MultiplayerAgent {
  private config: AgentConfig;
  private role: AgentRole;
  private gameType: GameType;
  private brain: AgentBrain;
  private coordinator: Coordinator;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private logger: SessionLogger;
  private sessionId: string;

  constructor(
    config: AgentConfig,
    role: AgentRole,
    gameType: GameType,
    coordinator: Coordinator,
  ) {
    this.config = config;
    this.role = role;
    this.gameType = gameType;
    this.coordinator = coordinator;

    const instructions = role === "host" ? HOST_INSTRUCTIONS : JOINER_INSTRUCTIONS;
    this.brain = new AgentBrain(config.model, instructions);
    this.sessionId = `${config.agentName}-${Date.now()}`;
    this.logger = new SessionLogger(
      this.sessionId,
      config.agentName,
      { ...config, role, gameType } as unknown as Record<string, unknown>,
      config.logDir,
    );

    fs.mkdirSync(config.screenshotDir, { recursive: true });
  }

  async start(): Promise<void> {
    console.log(`\n[${this.role.toUpperCase()}] Starting agent: ${this.config.agentName}`);
    console.log(`[${this.role.toUpperCase()}] Session: ${this.sessionId}`);
    console.log(`[${this.role.toUpperCase()}] Game type: ${this.gameType}`);
    console.log("");

    this.browser = await chromium.launch({
      headless: !this.config.headed,
    });

    const context = await this.browser.newContext({
      viewport: this.config.viewport,
      userAgent: `LAMO-TestAgent/1.0 (${this.role})`,
    });

    this.page = await context.newPage();

    const authToken = process.env.LAMO_AUTH_TOKEN;
    if (authToken) {
      await context.addInitScript((token) => {
        localStorage.setItem("lamo_auth_token", token);
      }, authToken);
    }

    try {
      if (this.role === "host") {
        await this.runAsHost();
      } else {
        await this.runAsJoiner();
      }
    } finally {
      await this.shutdown();
    }
  }

  private async runAsHost(): Promise<void> {
    const page = this.page!;
    const startPath = this.gameType === "trivia" ? "/create" : "/hunt/create";
    const startUrl = `${this.config.baseUrl}${startPath}`;

    await page.goto(startUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Signal that host is ready
    this.coordinator.publish({
      type: "agent_ready",
      fromAgent: this.config.agentName,
      payload: {},
    });

    // Run the agent loop — the brain will create the game and report the code
    await this.runLoop(async (observation) => {
      // Check if the agent found a game code or URL in its observation
      const desc = observation.description;
      const codeMatch = desc.match(/GAME_CODE:\s*(\S+)/i);
      const urlMatch = desc.match(/GAME_URL:\s*(\S+)/i);

      if (codeMatch || urlMatch) {
        const msgType = this.gameType === "trivia" ? "game_created" : "hunt_created";
        this.coordinator.publish({
          type: msgType,
          fromAgent: this.config.agentName,
          payload: {
            code: codeMatch?.[1],
            url: urlMatch?.[1],
            ...(this.gameType === "trivia"
              ? { gameId: codeMatch?.[1] }
              : { huntId: codeMatch?.[1] }),
          },
        });
      }
    });
  }

  private async runAsJoiner(): Promise<void> {
    const page = this.page!;

    // Signal readiness and wait for the host to create a game
    this.coordinator.publish({
      type: "agent_ready",
      fromAgent: this.config.agentName,
      payload: {},
    });

    console.log(`[JOINER] Waiting for ${this.gameType} to be created...`);
    const msgType = this.gameType === "trivia" ? "game_created" : "hunt_created";
    const msg = await this.coordinator.waitFor(msgType, 120000);

    // Navigate to the game
    let joinUrl: string;
    if (msg.payload.url) {
      joinUrl = msg.payload.url;
    } else if (msg.payload.gameId) {
      joinUrl = `${this.config.baseUrl}/game/${msg.payload.gameId}`;
    } else if (msg.payload.huntId) {
      joinUrl = `${this.config.baseUrl}/hunt/${msg.payload.huntId}`;
    } else {
      throw new Error("No join URL or game ID in coordination message");
    }

    console.log(`[JOINER] Joining at: ${joinUrl}`);
    await page.goto(joinUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Run the agent loop
    await this.runLoop();
  }

  private async runLoop(
    onObservation?: (observation: TurnLog["observation"]) => void,
  ): Promise<void> {
    const page = this.page!;

    for (let turn = 1; turn <= this.config.maxTurns; turn++) {
      const turnStart = Date.now();

      try {
        const screenshotFile = path.join(
          this.config.screenshotDir,
          `${this.sessionId}-turn-${turn}.png`,
        );
        await page.screenshot({ path: screenshotFile, fullPage: false });
        const screenshotBase64 = fs.readFileSync(screenshotFile).toString("base64");

        const [pageText, interactiveElements] = await Promise.all([
          getPageText(page),
          getInteractiveElements(page),
        ]);

        const pageUrl = page.url();
        const pageTitle = await page.title();

        const observation = await this.brain.decide(
          screenshotBase64,
          pageUrl,
          pageTitle,
          pageText,
          interactiveElements,
          turn,
          this.config.maxTurns,
        );

        // Notify callback (used by host to detect game codes)
        onObservation?.(observation);

        let actionResult: "success" | "error" = "success";
        let errorMessage: string | undefined;

        try {
          if (observation.action.type === "upload") {
            const photo = getRandomPhoto();
            observation.action.filePath = photo?.filePath ?? getPlaceholderPhotoPath();
          }

          await executeAction(page, observation.action);
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        } catch (err) {
          actionResult = "error";
          errorMessage = err instanceof Error ? err.message : String(err);
          console.warn(`  [${this.role.toUpperCase()}] Action error: ${errorMessage}`);
        }

        const turnLog: TurnLog = {
          turn,
          timestamp: new Date().toISOString(),
          url: pageUrl,
          pageTitle,
          observation,
          actionResult,
          errorMessage,
          screenshotFile,
          durationMs: Date.now() - turnStart,
        };

        this.logger.logTurn(turnLog);

        const delay = randomBetween(this.config.actionDelay.min, this.config.actionDelay.max);
        await page.waitForTimeout(delay);
      } catch (err) {
        console.error(`[${this.role.toUpperCase()}] Turn ${turn} failed:`, err);
        try {
          await page.goto(this.config.baseUrl, { waitUntil: "networkidle", timeout: 15000 });
        } catch {
          console.error(`[${this.role.toUpperCase()}] Failed to recover, ending session`);
          break;
        }
      }
    }

    this.coordinator.publish({
      type: "agent_finished",
      fromAgent: this.config.agentName,
      payload: {},
    });

    this.logger.finalize();
  }

  private async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
