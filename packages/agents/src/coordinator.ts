import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";

/**
 * File-based coordination layer for multiplayer agents.
 *
 * Agent A (host) creates a game/hunt and publishes the join code.
 * Agent B (joiner) polls for available codes and joins.
 *
 * Uses a simple JSON file as a shared message queue. This works for
 * agents running in the same process or on the same machine.
 * For distributed agents, swap this for Redis pub/sub.
 */

export interface CoordinationMessage {
  id: string;
  type: "game_created" | "hunt_created" | "group_created" | "agent_ready" | "agent_finished";
  /** The agent that sent this message */
  fromAgent: string;
  /** Join URL or code */
  payload: {
    url?: string;
    code?: string;
    gameId?: string;
    huntId?: string;
    groupId?: string;
  };
  timestamp: string;
  /** Whether this message has been consumed */
  consumed: boolean;
}

export class Coordinator {
  private queueFile: string;
  private emitter: EventEmitter;

  constructor(workDir: string) {
    fs.mkdirSync(workDir, { recursive: true });
    this.queueFile = path.join(workDir, "coordination-queue.json");
    this.emitter = new EventEmitter();

    // Initialize queue file if it doesn't exist
    if (!fs.existsSync(this.queueFile)) {
      this.writeQueue([]);
    }
  }

  /** Publish a message to the coordination queue */
  publish(message: Omit<CoordinationMessage, "id" | "timestamp" | "consumed">): void {
    const queue = this.readQueue();
    const full: CoordinationMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      consumed: false,
    };
    queue.push(full);
    this.writeQueue(queue);
    this.emitter.emit("message", full);
    console.log(`[Coordinator] Published: ${full.type} from ${full.fromAgent}`);
  }

  /**
   * Wait for a message of a specific type, with timeout.
   * Marks the message as consumed so other agents don't pick it up.
   */
  async waitFor(
    type: CoordinationMessage["type"],
    timeoutMs: number = 60000,
  ): Promise<CoordinationMessage> {
    const start = Date.now();
    const pollInterval = 500;

    while (Date.now() - start < timeoutMs) {
      const queue = this.readQueue();
      const msg = queue.find((m) => m.type === type && !m.consumed);

      if (msg) {
        msg.consumed = true;
        this.writeQueue(queue);
        console.log(`[Coordinator] Consumed: ${msg.type} from ${msg.fromAgent}`);
        return msg;
      }

      await sleep(pollInterval);
    }

    throw new Error(`Timeout waiting for message type "${type}" after ${timeoutMs}ms`);
  }

  /**
   * Wait for a specific agent to signal readiness.
   */
  async waitForAgent(agentName: string, timeoutMs: number = 30000): Promise<void> {
    const start = Date.now();
    const pollInterval = 500;

    while (Date.now() - start < timeoutMs) {
      const queue = this.readQueue();
      const msg = queue.find(
        (m) => m.type === "agent_ready" && m.fromAgent === agentName && !m.consumed,
      );
      if (msg) {
        msg.consumed = true;
        this.writeQueue(queue);
        return;
      }
      await sleep(pollInterval);
    }

    throw new Error(`Timeout waiting for agent "${agentName}" to be ready`);
  }

  /** Reset the queue (useful between test runs) */
  reset(): void {
    this.writeQueue([]);
    console.log("[Coordinator] Queue reset");
  }

  /** Get all messages (for debugging) */
  getAll(): CoordinationMessage[] {
    return this.readQueue();
  }

  private readQueue(): CoordinationMessage[] {
    try {
      const data = fs.readFileSync(this.queueFile, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private writeQueue(queue: CoordinationMessage[]): void {
    fs.writeFileSync(this.queueFile, JSON.stringify(queue, null, 2));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
