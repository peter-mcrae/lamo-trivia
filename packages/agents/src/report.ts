import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionLog, AgentIssue, IssueSeverity } from "./types.js";

export interface AggregateReport {
  generatedAt: string;
  sessionCount: number;
  totalTurns: number;
  totalDurationMs: number;
  pagesVisited: string[];
  coveragePercent: number;
  issues: {
    total: number;
    bySeverity: Record<IssueSeverity, AgentIssue[]>;
  };
  sessions: SessionSummary[];
}

interface SessionSummary {
  sessionId: string;
  agentName: string;
  startedAt: string;
  turns: number;
  issueCount: number;
  pagesVisited: number;
  durationMs: number;
}

/** All known pages in the app (for coverage calculation) */
const KNOWN_PAGES = [
  "/",
  "/create",
  "/about",
  "/how-to-play",
  "/how-to-hunt",
  "/login",
  "/credits",
  "/groups",
  "/group/new",
  "/group/join",
  "/riddle-wordle",
  "/hunt/create",
  "/game/",     // dynamic
  "/hunt/",     // dynamic
  "/group/",    // dynamic
];

/**
 * Load all session logs from a directory.
 */
export function loadSessions(logDir: string): SessionLog[] {
  if (!fs.existsSync(logDir)) return [];

  return fs.readdirSync(logDir)
    .filter((f) => f.endsWith(".json") && f !== "coordination-queue.json")
    .map((f) => {
      try {
        const data = fs.readFileSync(path.join(logDir, f), "utf-8");
        return JSON.parse(data) as SessionLog;
      } catch {
        return null;
      }
    })
    .filter((s): s is SessionLog => s !== null);
}

/**
 * Generate an aggregate report from multiple session logs.
 */
export function generateReport(sessions: SessionLog[]): AggregateReport {
  const allIssues: AgentIssue[] = [];
  const allPages = new Set<string>();
  let totalTurns = 0;
  let totalDuration = 0;

  const sessionSummaries: SessionSummary[] = [];

  for (const session of sessions) {
    totalTurns += session.totalTurns;

    const duration = session.endedAt
      ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
      : 0;
    totalDuration += duration;

    for (const page of session.pagesVisited) {
      allPages.add(normalizePagePath(page));
    }

    for (const issue of session.issues) {
      allIssues.push(issue);
    }

    sessionSummaries.push({
      sessionId: session.sessionId,
      agentName: session.agentName,
      startedAt: session.startedAt,
      turns: session.totalTurns,
      issueCount: session.issues.length,
      pagesVisited: session.pagesVisited.length,
      durationMs: duration,
    });
  }

  // Calculate coverage
  const visitedKnown = KNOWN_PAGES.filter((page) => {
    if (page.endsWith("/")) {
      // Dynamic route — check if any visited page starts with this prefix
      return [...allPages].some((p) => p.startsWith(page));
    }
    return allPages.has(page);
  });
  const coveragePercent = KNOWN_PAGES.length > 0
    ? Math.round((visitedKnown.length / KNOWN_PAGES.length) * 100)
    : 0;

  // Group issues by severity
  const bySeverity: Record<IssueSeverity, AgentIssue[]> = {
    critical: [],
    major: [],
    minor: [],
    suggestion: [],
  };
  for (const issue of allIssues) {
    (bySeverity[issue.severity] ??= []).push(issue);
  }

  return {
    generatedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    totalTurns,
    totalDurationMs: totalDuration,
    pagesVisited: [...allPages].sort(),
    coveragePercent,
    issues: { total: allIssues.length, bySeverity },
    sessions: sessionSummaries,
  };
}

/**
 * Format the report as a human-readable string.
 */
export function formatReport(report: AggregateReport): string {
  const lines: string[] = [];

  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║       LAMO Agents — Aggregate Test Report           ║");
  lines.push("╚══════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Sessions:  ${report.sessionCount}`);
  lines.push(`Turns:     ${report.totalTurns}`);
  lines.push(`Duration:  ${formatDuration(report.totalDurationMs)}`);
  lines.push(`Coverage:  ${report.coveragePercent}% (${report.pagesVisited.length} pages visited)`);
  lines.push("");

  // Issues summary
  lines.push("── Issues ─────────────────────────────────────────────");
  lines.push(`Total: ${report.issues.total}`);
  for (const severity of ["critical", "major", "minor", "suggestion"] as IssueSeverity[]) {
    const issues = report.issues.bySeverity[severity];
    if (issues.length > 0) {
      const icon = severity === "critical" ? "🔴"
        : severity === "major" ? "🟠"
        : severity === "minor" ? "🟡"
        : "💡";
      lines.push(`\n  ${icon} ${severity.toUpperCase()} (${issues.length}):`);
      for (const issue of issues) {
        lines.push(`     • ${issue.description}`);
        lines.push(`       Page: ${issue.page}`);
        lines.push(`       Expected: ${issue.expected}`);
        lines.push(`       Actual: ${issue.actual}`);
      }
    }
  }

  if (report.issues.total === 0) {
    lines.push("  No issues found!");
  }

  lines.push("");

  // Pages visited
  lines.push("── Pages Visited ──────────────────────────────────────");
  for (const page of report.pagesVisited) {
    lines.push(`  ${page}`);
  }
  lines.push("");

  // Session breakdown
  lines.push("── Sessions ───────────────────────────────────────────");
  for (const s of report.sessions) {
    lines.push(
      `  ${s.agentName.padEnd(20)} ${s.turns} turns | ${s.issueCount} issues | ${s.pagesVisited} pages | ${formatDuration(s.durationMs)}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function normalizePagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
