interface Env {
  TARGET_URL: string;
}

interface StepResult {
  step: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

interface MonitorResult {
  success: boolean;
  totalDurationMs: number;
  steps: StepResult[];
  timestamp: string;
  gameId?: string;
}

// Game config optimized for speed (~30s total game time)
const MONITOR_GAME_CONFIG = {
  name: '[Monitor] Synthetic Test',
  categoryIds: ['general'],
  questionCount: 5,
  timePerQuestion: 1,
  minPlayers: 1,
  maxPlayers: 2,
  scoringMethod: 'correct-only',
  streakBonus: false,
  showAnswers: false,
  timeBetweenQuestions: 1,
  isPrivate: true,
};

const MONITOR_USERNAME = '_monitor_bot';
const WS_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 10_000;

// --- Message queue for reliable WebSocket message handling ---

interface MessageQueue {
  waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
}

function createMessageQueue(ws: WebSocket): MessageQueue {
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<{
    type: string;
    resolve: (msg: Record<string, unknown>) => void;
    reject: (err: Error) => void;
  }> = [];

  ws.addEventListener('message', (event: MessageEvent) => {
    try {
      const data = JSON.parse(typeof event.data === 'string' ? event.data : '');

      // Check if anyone is waiting for this type
      const waiterIndex = waiters.findIndex((w) => w.type === data.type);
      if (waiterIndex >= 0) {
        const waiter = waiters.splice(waiterIndex, 1)[0];
        waiter.resolve(data);
      } else if (data.type === 'error') {
        // Deliver server errors to the first waiter
        if (waiters.length > 0) {
          const waiter = waiters.shift()!;
          waiter.reject(new Error(`Server error: ${data.message}`));
        }
      } else {
        // Buffer for later consumption
        queue.push(data);
      }
    } catch {
      // Ignore parse errors
    }
  });

  function waitFor(type: string, timeoutMs: number = WS_TIMEOUT_MS): Promise<Record<string, unknown>> {
    // Check buffer first
    const idx = queue.findIndex((m) => m.type === type);
    if (idx >= 0) {
      return Promise.resolve(queue.splice(idx, 1)[0]);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const wi = waiters.findIndex((w) => w.resolve === wrappedResolve);
        if (wi >= 0) waiters.splice(wi, 1);
        reject(new Error(`Timeout waiting for '${type}' after ${timeoutMs}ms`));
      }, timeoutMs);

      const wrappedResolve = (msg: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(msg);
      };
      const wrappedReject = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      waiters.push({ type, resolve: wrappedResolve, reject: wrappedReject });
    });
  }

  return { waitFor };
}

// --- Step runner with timing and timeout ---

async function runStep<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs: number = HTTP_TIMEOUT_MS,
): Promise<{ result: T; stepResult: StepResult }> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return {
      result,
      stepResult: { step: name, passed: true, durationMs: Date.now() - start },
    };
  } catch (err) {
    return {
      result: undefined as T,
      stepResult: {
        step: name,
        passed: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// --- Core monitor flow ---

async function runMonitor(targetUrl: string): Promise<MonitorResult> {
  const steps: StepResult[] = [];
  const overallStart = Date.now();
  let gameId: string | undefined;
  let ws: WebSocket | undefined;

  try {
    // Step 1: Health check
    const health = await runStep('health_check', async () => {
      const res = await fetch(`${targetUrl}/api/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { status: string };
      if (body.status !== 'ok') throw new Error(`Status: ${body.status}`);
      return body;
    });
    steps.push(health.stepResult);
    if (!health.stepResult.passed) throw new Error('Health check failed');

    // Step 2: Verify categories
    const categories = await runStep('fetch_categories', async () => {
      const res = await fetch(`${targetUrl}/api/categories`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        categories: Array<{ id: string; questionCount: number }>;
      };
      const general = body.categories.find((c) => c.id === 'general');
      if (!general) throw new Error("'general' category not found");
      if (general.questionCount < 5)
        throw new Error(`Only ${general.questionCount} questions in 'general'`);
      return body;
    });
    steps.push(categories.stepResult);
    if (!categories.stepResult.passed) throw new Error('Categories check failed');

    // Step 3: Create game
    const createGame = await runStep('create_game', async () => {
      const res = await fetch(`${targetUrl}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(MONITOR_GAME_CONFIG),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HTTP ${res.status}: ${errBody}`);
      }
      const body = (await res.json()) as { gameId: string };
      if (!body.gameId) throw new Error('No gameId in response');
      return body;
    });
    steps.push(createGame.stepResult);
    if (!createGame.stepResult.passed) throw new Error('Game creation failed');
    gameId = createGame.result.gameId;

    // Step 4: Connect WebSocket (Workers use http(s) URL with Upgrade header)
    const connectWs = await runStep('ws_connect', async () => {
      const res = await fetch(`${targetUrl}/ws/game/${gameId}`, {
        headers: { Upgrade: 'websocket' },
      });
      const webSocket = res.webSocket;
      if (!webSocket) throw new Error('No webSocket in response');
      webSocket.accept();
      return webSocket;
    });
    steps.push(connectWs.stepResult);
    if (!connectWs.stepResult.passed) throw new Error('WebSocket connect failed');
    ws = connectWs.result;

    const { waitFor } = createMessageQueue(ws);

    // Step 5: Join game
    const joinGame = await runStep(
      'join_game',
      async () => {
        ws!.send(JSON.stringify({ type: 'join_game', gameId, username: MONITOR_USERNAME }));
        const msg = await waitFor('game_state');
        const state = msg.state as { phase: string; players: unknown[] };
        if (state.phase !== 'waiting') throw new Error(`Unexpected phase: ${state.phase}`);
        return msg;
      },
      WS_TIMEOUT_MS,
    );
    steps.push(joinGame.stepResult);
    if (!joinGame.stepResult.passed) throw new Error('Join game failed');

    // Step 6: Start game
    const startGame = await runStep(
      'start_game',
      async () => {
        ws!.send(JSON.stringify({ type: 'start_game' }));
        const msg = await waitFor('game_starting');
        return msg;
      },
      WS_TIMEOUT_MS,
    );
    steps.push(startGame.stepResult);
    if (!startGame.stepResult.passed) throw new Error('Start game failed');

    // Step 7: Play through all questions
    // Timeout: 30s base + (5s timer + 2s buffer) per question
    const playTimeout =
      WS_TIMEOUT_MS + (MONITOR_GAME_CONFIG.timePerQuestion * 1000 + 2000) * MONITOR_GAME_CONFIG.questionCount;

    const playGame = await runStep(
      'play_questions',
      async () => {
        for (let i = 0; i < MONITOR_GAME_CONFIG.questionCount; i++) {
          const questionMsg = await waitFor('question');
          const questionIndex = questionMsg.questionIndex as number;

          ws!.send(JSON.stringify({ type: 'submit_answer', questionIndex, answerIndex: 0 }));

          await waitFor('answer_result');
        }
        return { questionsAnswered: MONITOR_GAME_CONFIG.questionCount };
      },
      playTimeout,
    );
    steps.push(playGame.stepResult);
    if (!playGame.stepResult.passed) throw new Error('Play questions failed');

    // Step 8: Verify game finished
    const gameFinished = await runStep(
      'game_finished',
      async () => {
        const msg = await waitFor('game_finished');
        const rankings = msg.rankings as unknown[];
        if (!rankings || rankings.length === 0) throw new Error('No rankings in game_finished');
        return msg;
      },
      WS_TIMEOUT_MS,
    );
    steps.push(gameFinished.stepResult);
    if (!gameFinished.stepResult.passed) throw new Error('Game finish failed');
  } catch {
    // Flow aborted — step failure already recorded
  } finally {
    if (ws) {
      try {
        ws.close(1000, 'Monitor complete');
      } catch {
        // Already closed
      }
    }
  }

  const totalDurationMs = Date.now() - overallStart;
  const success = steps.every((s) => s.passed);

  return { success, totalDurationMs, steps, timestamp: new Date().toISOString(), gameId };
}

// --- Logging ---

function logResults(result: MonitorResult): void {
  const icon = result.success ? 'PASS' : 'FAIL';
  console.log(`=== LAMO Trivia Monitor: ${icon} ===`);
  console.log(`Timestamp: ${result.timestamp}`);
  console.log(`Game ID:   ${result.gameId ?? 'N/A'}`);
  console.log(`Duration:  ${result.totalDurationMs}ms`);
  console.log('--- Steps ---');
  for (const step of result.steps) {
    const status = step.passed ? 'PASS' : 'FAIL';
    const error = step.error ? ` | ${step.error}` : '';
    console.log(`  ${status} ${step.step} (${step.durationMs}ms)${error}`);
  }
  console.log('=============================');
}

// --- Worker export ---

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await runMonitor(env.TARGET_URL);
    logResults(result);
  },

  async fetch(_request: Request, env: Env): Promise<Response> {
    const result = await runMonitor(env.TARGET_URL);
    logResults(result);
    return Response.json(result, { status: result.success ? 200 : 503 });
  },
};
