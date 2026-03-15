export interface AgentAction {
  type: "click" | "type" | "navigate" | "scroll" | "wait" | "select" | "back" | "refresh" | "screenshot" | "resize" | "keyboard" | "upload";
  /** CSS selector for click/type/select actions */
  selector?: string;
  /** Text to type */
  text?: string;
  /** URL to navigate to */
  url?: string;
  /** Scroll direction */
  direction?: "up" | "down";
  /** Scroll amount in pixels */
  amount?: number;
  /** Wait duration in ms */
  duration?: number;
  /** Viewport for resize */
  viewport?: { width: number; height: number };
  /** Value for select */
  value?: string;
  /** Key to press (for keyboard action, e.g., "Enter", "Backspace", "a", "b") */
  key?: string;
  /** File path to upload (for upload action) */
  filePath?: string;
}

export type IssueSeverity = "critical" | "major" | "minor" | "suggestion";

export interface AgentObservation {
  /** What the agent sees on the page */
  description: string;
  /** Any issues found */
  issues: AgentIssue[];
  /** Next action to take */
  action: AgentAction;
  /** Reasoning for the action */
  reasoning: string;
}

export interface AgentIssue {
  page: string;
  description: string;
  expected: string;
  actual: string;
  severity: IssueSeverity;
  screenshotFile?: string;
}

export interface TurnLog {
  turn: number;
  timestamp: string;
  url: string;
  pageTitle: string;
  observation: AgentObservation;
  actionResult: "success" | "error";
  errorMessage?: string;
  screenshotFile: string;
  durationMs: number;
}

export interface SessionLog {
  sessionId: string;
  agentName: string;
  startedAt: string;
  endedAt?: string;
  config: Record<string, unknown>;
  turns: TurnLog[];
  issues: AgentIssue[];
  pagesVisited: string[];
  totalTurns: number;
}
