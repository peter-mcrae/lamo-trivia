import * as fs from "node:fs";
import * as path from "node:path";
import { loadSessions, generateReport, formatReport } from "./report.js";

const args = process.argv.slice(2);
const pkgRoot = path.resolve(import.meta.dirname, "..");
const logDir = args.find((a) => !a.startsWith("--")) ?? path.join(pkgRoot, "logs");
const outputJson = args.includes("--json");
const outputFile = args.find((a) => a.startsWith("--out="))?.split("=")[1];

if (args.includes("--help")) {
  console.log("LAMO Autonomous Testing Agent - Report Generator");
  console.log("=================================================\n");
  console.log("Usage: npx tsx src/run-report.ts [log-dir] [options]\n");
  console.log("Options:");
  console.log("  --json          Output raw JSON instead of formatted text");
  console.log("  --out=FILE      Write report to a file");
  console.log("  --help          Show this help message");
  console.log(`\nDefault log directory: ${path.join(pkgRoot, "logs")}`);
  process.exit(0);
}

const sessions = loadSessions(logDir);

if (sessions.length === 0) {
  console.log(`No session logs found in: ${logDir}`);
  console.log("Run some agents first, then come back to generate a report.");
  process.exit(0);
}

const report = generateReport(sessions);

if (outputJson) {
  const json = JSON.stringify(report, null, 2);
  if (outputFile) {
    fs.writeFileSync(outputFile, json);
    console.log(`JSON report written to: ${outputFile}`);
  } else {
    console.log(json);
  }
} else {
  const text = formatReport(report);
  if (outputFile) {
    fs.writeFileSync(outputFile, text);
    console.log(`Report written to: ${outputFile}`);
  } else {
    console.log(text);
  }
}
