import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { AgentConfig } from "./config.js";
import type { TurnLog } from "./types.js";
import type { TestScenario } from "./scenarios.js";
import { AgentBrain } from "./brain.js";
import { executeAction, getPageText, getInteractiveElements } from "./executor.js";
import { SessionLogger } from "./logger.js";
import { getPlaceholderPhotoPath, getRandomPhoto } from "./photos.js";

export class ExplorerAgent {
  private config: AgentConfig;
  private brain: AgentBrain;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private logger: SessionLogger;
  private sessionId: string;
  private scenario: TestScenario | null;

  constructor(config: AgentConfig, scenario?: TestScenario) {
    this.config = config;
    this.scenario = scenario ?? null;
    this.brain = new AgentBrain(config.model, scenario?.instructions);
    this.sessionId = `${config.agentName}-${Date.now()}`;
    this.logger = new SessionLogger(
      this.sessionId,
      config.agentName,
      config as unknown as Record<string, unknown>,
      config.logDir,
    );

    // Ensure screenshot dir exists
    fs.mkdirSync(config.screenshotDir, { recursive: true });
  }

  async start(): Promise<void> {
    const scenarioName = this.scenario?.name ?? "Free Exploration";
    console.log(`\nStarting agent: ${this.config.agentName}`);
    console.log(`Scenario: ${scenarioName}`);
    console.log(`Session: ${this.sessionId}`);
    console.log(`Target: ${this.config.baseUrl}`);
    console.log(`Max turns: ${this.config.maxTurns}`);
    console.log(`Viewport: ${this.config.viewport.width}x${this.config.viewport.height}`);
    console.log("");

    this.browser = await chromium.launch({
      headless: !this.config.headed,
    });

    const context = await this.browser.newContext({
      viewport: this.config.viewport,
      userAgent: "LAMO-TestAgent/1.0",
    });

    this.page = await context.newPage();

    // Inject auth token if available from env
    const authToken = process.env.LAMO_AUTH_TOKEN;
    if (authToken) {
      await context.addInitScript((token) => {
        localStorage.setItem("lamo_auth_token", token);
      }, authToken);
      console.log("Injected auth token from LAMO_AUTH_TOKEN env var");
    }

    try {
      const startUrl = this.scenario?.startPath
        ? `${this.config.baseUrl}${this.scenario.startPath}`
        : this.config.baseUrl;
      await this.page.goto(startUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await this.runLoop();
    } finally {
      await this.shutdown();
    }
  }

  private async runLoop(): Promise<void> {
    const page = this.page!;

    for (let turn = 1; turn <= this.config.maxTurns; turn++) {
      const turnStart = Date.now();

      try {
        // 1. Capture page state
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

        // 2. Ask Claude what to do
        const observation = await this.brain.decide(
          screenshotBase64,
          pageUrl,
          pageTitle,
          pageText,
          interactiveElements,
          turn,
          this.config.maxTurns,
        );

        // 3. Execute the action
        let actionResult: "success" | "error" = "success";
        let errorMessage: string | undefined;

        try {
          // If the agent wants to upload a file, resolve a real photo path
          if (observation.action.type === "upload") {
            const photo = getRandomPhoto();
            observation.action.filePath = photo?.filePath ?? getPlaceholderPhotoPath();
          }

          await executeAction(page, observation.action);
          // Wait for any navigation / network to settle
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        } catch (err) {
          actionResult = "error";
          errorMessage = err instanceof Error ? err.message : String(err);
          console.warn(`  Action error: ${errorMessage}`);
        }

        // 4. Log the turn
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

        // 5. Wait between actions (simulate human timing)
        const delay = randomBetween(this.config.actionDelay.min, this.config.actionDelay.max);
        await page.waitForTimeout(delay);
      } catch (err) {
        console.error(`Turn ${turn} failed:`, err);
        // Try to recover by navigating home
        try {
          await page.goto(this.config.baseUrl, { waitUntil: "networkidle", timeout: 15000 });
        } catch {
          console.error("Failed to recover, ending session");
          break;
        }
      }
    }

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
