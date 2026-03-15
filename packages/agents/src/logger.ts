import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionLog, TurnLog, AgentIssue } from "./types.js";

export class SessionLogger {
  private session: SessionLog;
  private logFile: string;

  constructor(sessionId: string, agentName: string, config: Record<string, unknown>, logDir: string) {
    this.session = {
      sessionId,
      agentName,
      startedAt: new Date().toISOString(),
      config,
      turns: [],
      issues: [],
      pagesVisited: [],
      totalTurns: 0,
    };

    fs.mkdirSync(logDir, { recursive: true });
    this.logFile = path.join(logDir, `${sessionId}.json`);
  }

  logTurn(turn: TurnLog): void {
    this.session.turns.push(turn);
    this.session.totalTurns = this.session.turns.length;

    if (!this.session.pagesVisited.includes(turn.url)) {
      this.session.pagesVisited.push(turn.url);
    }

    // Add any issues from this turn
    for (const issue of turn.observation.issues) {
      this.session.issues.push(issue);
    }

    this.flush();
    this.printTurnSummary(turn);
  }

  finalize(): SessionLog {
    this.session.endedAt = new Date().toISOString();
    this.flush();
    this.printSessionSummary();
    return this.session;
  }

  private flush(): void {
    fs.writeFileSync(this.logFile, JSON.stringify(this.session, null, 2));
  }

  private printTurnSummary(turn: TurnLog): void {
    const action = turn.observation.action;
    const actionStr = action.type === "click" ? `click ${action.selector}`
      : action.type === "type" ? `type "${action.text}" into ${action.selector}`
      : action.type === "navigate" ? `navigate to ${action.url}`
      : action.type === "scroll" ? `scroll ${action.direction}`
      : action.type === "wait" ? `wait ${action.duration}ms`
      : action.type;

    const issueCount = turn.observation.issues.length;
    const issueStr = issueCount > 0 ? ` | ${issueCount} issue(s) found` : "";
    const status = turn.actionResult === "success" ? "✓" : "✗";

    console.log(
      `[Turn ${turn.turn}] ${status} ${actionStr} | ${turn.url}${issueStr} (${turn.durationMs}ms)`
    );

    for (const issue of turn.observation.issues) {
      console.log(`  ⚠ [${issue.severity}] ${issue.description}`);
    }
  }

  private printSessionSummary(): void {
    const duration = this.session.endedAt
      ? new Date(this.session.endedAt).getTime() - new Date(this.session.startedAt).getTime()
      : 0;

    console.log("\n========== Session Summary ==========");
    console.log(`Session: ${this.session.sessionId}`);
    console.log(`Agent: ${this.session.agentName}`);
    console.log(`Duration: ${Math.round(duration / 1000)}s`);
    console.log(`Turns: ${this.session.totalTurns}`);
    console.log(`Pages visited: ${this.session.pagesVisited.length}`);
    console.log(`Issues found: ${this.session.issues.length}`);

    if (this.session.issues.length > 0) {
      const bySeverity: Record<string, AgentIssue[]> = {};
      for (const issue of this.session.issues) {
        (bySeverity[issue.severity] ??= []).push(issue);
      }
      for (const [severity, issues] of Object.entries(bySeverity)) {
        console.log(`  ${severity}: ${issues.length}`);
        for (const issue of issues) {
          console.log(`    - ${issue.description} (${issue.page})`);
        }
      }
    }

    console.log(`\nLog saved to: ${this.logFile}`);
    console.log("=====================================\n");
  }
}
