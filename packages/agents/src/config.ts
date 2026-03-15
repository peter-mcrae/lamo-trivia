export interface AgentConfig {
  /** Base URL of the app to test */
  baseUrl: string;
  /** Max number of turns (actions) per session */
  maxTurns: number;
  /** Delay between actions in ms (simulates human timing) */
  actionDelay: { min: number; max: number };
  /** Viewport size */
  viewport: { width: number; height: number };
  /** Whether to run in headed mode (visible browser) */
  headed: boolean;
  /** Claude model to use */
  model: string;
  /** Directory for screenshots */
  screenshotDir: string;
  /** Directory for logs */
  logDir: string;
  /** Agent identity */
  agentName: string;
  /** Test account email (for auth flows) */
  testEmail?: string;
}

export const DEFAULT_CONFIG: AgentConfig = {
  baseUrl: "https://lamotrivia.app",
  maxTurns: 100,
  actionDelay: { min: 2000, max: 5000 },
  model: "claude-sonnet-4-20250514",
  viewport: { width: 1440, height: 900 },
  headed: false,
  screenshotDir: "screenshots",
  logDir: "logs",
  agentName: "explorer-1",
  testEmail: undefined,
};

export const MOBILE_VIEWPORT = { width: 375, height: 812 };

export function resolveConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
