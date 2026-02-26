import type { Player, GameConfig, GamePhase, Question, ClientQuestion, GameState, Avatar } from '@lamo-trivia/shared';
import { ClientMessageSchema, AVATARS, GAME_EXPIRY_MS } from '@lamo-trivia/shared';
import type { Env } from './env';
import { getQuestions } from './questions';

type AlarmAction = 'expire_game' | 'send_question' | 'end_question' | 'show_next_or_finish';

interface RoomState {
  gameId: string;
  config: GameConfig;
  phase: GamePhase;
  hostId: string;
  players: Player[];
  questions: Question[];
  currentQuestionIndex: number;
  scores: Record<string, number>;
  streaks: Record<string, number>;
  answersThisRound: Record<string, number>;
  questionStartedAt: number;
  nextAlarmAction: AlarmAction | null;
  createdAt: number;
  startedAt?: number;
}

export class GameRoom {
  private state: DurableObjectState;
  private env: Env;
  private room: RoomState | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<RoomState>('room');
      if (stored) this.room = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/config') {
      const body = (await request.json()) as GameConfig & { gameId: string };
      this.room = {
        gameId: body.gameId,
        config: body,
        phase: 'waiting',
        hostId: '',
        players: [],
        questions: [],
        currentQuestionIndex: 0,
        scores: {},
        streaks: {},
        answersThisRound: {},
        questionStartedAt: 0,
        nextAlarmAction: 'expire_game',
        createdAt: Date.now(),
      };
      await this.persist();

      // Set 20-minute expiry alarm — overwritten if game starts
      await this.state.storage.setAlarm(Date.now() + GAME_EXPIRY_MS);

      return Response.json({ ok: true });
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Expected WebSocket or /config', { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      const parsed = ClientMessageSchema.safeParse(data);
      if (!parsed.success) {
        this.sendTo(ws, { type: 'error', message: 'Invalid message format' });
        return;
      }

      switch (parsed.data.type) {
        case 'join_game':
          await this.handleJoin(ws, parsed.data.username);
          break;
        case 'leave_game':
          await this.handleLeave(ws);
          break;
        case 'start_game':
          await this.handleStartGame(ws);
          break;
        case 'submit_answer':
          await this.handleSubmitAnswer(ws, parsed.data.questionIndex, parsed.data.answerIndex);
          break;
        case 'ping':
          this.sendTo(ws, { type: 'pong' });
          break;
      }
    } catch {
      this.sendTo(ws, { type: 'error', message: 'Failed to parse message' });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleLeave(ws);
  }

  async alarm(): Promise<void> {
    if (!this.room) return;

    switch (this.room.nextAlarmAction) {
      case 'expire_game':
        await this.expireGame();
        break;
      case 'send_question':
        await this.sendCurrentQuestion();
        break;
      case 'end_question':
        await this.endCurrentQuestion();
        break;
      case 'show_next_or_finish':
        await this.advanceOrFinish();
        break;
    }
  }

  // --- Handlers ---

  private async handleJoin(ws: WebSocket, username: string): Promise<void> {
    if (!this.room) {
      this.sendTo(ws, { type: 'error', message: 'Game not found', code: 'GAME_NOT_FOUND' });
      return;
    }

    if (this.room.phase !== 'waiting') {
      this.sendTo(ws, { type: 'error', message: 'Game already started', code: 'GAME_STARTED' });
      return;
    }

    if (this.room.players.length >= this.room.config.maxPlayers) {
      this.sendTo(ws, { type: 'error', message: 'Game is full', code: 'GAME_FULL' });
      return;
    }

    if (this.room.players.some((p) => p.username.toLowerCase() === username.toLowerCase())) {
      this.sendTo(ws, { type: 'error', message: 'Username already taken in this game', code: 'USERNAME_TAKEN' });
      return;
    }

    const playerId = crypto.randomUUID();
    const avatar = this.pickAvatar();
    const player: Player = {
      id: playerId,
      username,
      avatar,
      connectedAt: Date.now(),
      score: 0,
    };

    // Attach player ID to WebSocket (persists across hibernation)
    ws.serializeAttachment(playerId);

    this.room.players.push(player);
    this.room.scores[playerId] = 0;
    this.room.streaks[playerId] = 0;

    if (this.room.hostId === '') {
      this.room.hostId = playerId;
    }

    await this.persist();

    // Send full state to the joining player
    this.sendTo(ws, { type: 'game_state', state: this.getClientGameState() });

    // Broadcast to everyone else
    this.broadcastExcept(ws, { type: 'player_joined', player });
  }

  private async handleLeave(ws: WebSocket): Promise<void> {
    if (!this.room) return;

    const playerId = this.getPlayerId(ws);
    if (!playerId) return;

    this.room.players = this.room.players.filter((p) => p.id !== playerId);
    delete this.room.scores[playerId];
    delete this.room.streaks[playerId];

    // Reassign host if the host left
    if (this.room.hostId === playerId && this.room.players.length > 0) {
      this.room.hostId = this.room.players[0].id;
    }

    await this.persist();
    this.broadcast({ type: 'player_left', playerId });
  }

  private async handleStartGame(ws: WebSocket): Promise<void> {
    if (!this.room) return;

    const playerId = this.getPlayerId(ws);
    if (playerId !== this.room.hostId) {
      this.sendTo(ws, { type: 'error', message: 'Only the host can start the game' });
      return;
    }

    if (this.room.players.length < this.room.config.minPlayers) {
      this.sendTo(ws, {
        type: 'error',
        message: `Need at least ${this.room.config.minPlayers} players to start`,
      });
      return;
    }

    // Fetch questions from KV
    this.room.questions = await getQuestions(
      this.env.TRIVIA_KV,
      this.room.config.categoryIds,
      this.room.config.questionCount,
    );

    if (this.room.questions.length === 0) {
      this.sendTo(ws, { type: 'error', message: 'No questions available for selected categories' });
      return;
    }

    this.room.phase = 'starting';
    this.room.startedAt = Date.now();
    this.room.currentQuestionIndex = 0;
    this.room.nextAlarmAction = 'send_question';

    await this.persist();

    this.broadcast({ type: 'game_starting', countdown: 3 });

    // After 3 second countdown, send first question
    await this.state.storage.setAlarm(Date.now() + 3000);
  }

  private async handleSubmitAnswer(
    ws: WebSocket,
    questionIndex: number,
    answerIndex: number,
  ): Promise<void> {
    if (!this.room || this.room.phase !== 'playing') return;

    const playerId = this.getPlayerId(ws);
    if (!playerId) return;

    // Ignore if not the current question or already answered
    if (questionIndex !== this.room.currentQuestionIndex) return;
    if (playerId in this.room.answersThisRound) return;

    this.room.answersThisRound[playerId] = answerIndex;

    const question = this.room.questions[this.room.currentQuestionIndex];
    const correct = answerIndex === question.correctIndex;
    const timeElapsed = (Date.now() - this.room.questionStartedAt) / 1000;
    const timeRemaining = Math.max(0, this.room.config.timePerQuestion - timeElapsed);

    // Calculate score
    let points = 0;
    if (correct) {
      if (this.room.config.scoringMethod === 'speed-bonus') {
        points = Math.round(1000 * (timeRemaining / this.room.config.timePerQuestion));
        points = Math.max(points, 100); // minimum 100 for correct answer
      } else {
        points = 1000;
      }

      // Streak bonus
      this.room.streaks[playerId] = (this.room.streaks[playerId] || 0) + 1;
      if (this.room.config.streakBonus) {
        const multiplier = Math.min(this.room.streaks[playerId], 3);
        points = points * multiplier;
      }
    } else {
      this.room.streaks[playerId] = 0;
    }

    this.room.scores[playerId] = (this.room.scores[playerId] || 0) + points;

    // Update the player's score in the players array too
    const player = this.room.players.find((p) => p.id === playerId);
    if (player) player.score = this.room.scores[playerId];

    await this.persist();

    // Send individual result to the answering player
    this.sendTo(ws, {
      type: 'answer_result',
      correct,
      correctIndex: question.correctIndex,
      scores: this.room.scores,
    });

    // Check if all players have answered
    const allAnswered = this.room.players.every((p) => p.id in this.room!.answersThisRound);
    if (allAnswered) {
      await this.state.storage.deleteAlarm();
      await this.endCurrentQuestion();
    }
  }

  // --- Alarm actions ---

  private async sendCurrentQuestion(): Promise<void> {
    if (!this.room) return;

    this.room.phase = 'playing';
    this.room.answersThisRound = {};
    this.room.questionStartedAt = Date.now();

    const question = this.room.questions[this.room.currentQuestionIndex];
    const clientQuestion: ClientQuestion = {
      id: question.id,
      text: question.text,
      options: question.options,
      categoryId: question.categoryId,
    };

    this.room.nextAlarmAction = 'end_question';
    await this.persist();

    this.broadcast({
      type: 'question',
      question: clientQuestion,
      questionIndex: this.room.currentQuestionIndex,
      totalQuestions: this.room.questions.length,
    });

    // Set alarm for when the question timer expires
    await this.state.storage.setAlarm(Date.now() + this.room.config.timePerQuestion * 1000);
  }

  private async endCurrentQuestion(): Promise<void> {
    if (!this.room) return;

    const question = this.room.questions[this.room.currentQuestionIndex];

    // Reset streak for players who didn't answer
    for (const player of this.room.players) {
      if (!(player.id in this.room.answersThisRound)) {
        this.room.streaks[player.id] = 0;
      }
    }

    await this.persist();

    // Send answer_result to players who timed out
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      const pid = this.getPlayerId(ws);
      if (!pid) continue;
      if (pid in this.room.answersThisRound) continue;
      this.sendTo(ws, {
        type: 'answer_result',
        correct: false,
        correctIndex: question.correctIndex,
        scores: this.room.scores,
      });
    }

    if (this.room.config.showAnswers) {
      this.room.nextAlarmAction = 'show_next_or_finish';
      await this.persist();
      await this.state.storage.setAlarm(Date.now() + this.room.config.timeBetweenQuestions * 1000);
    } else {
      await this.advanceOrFinish();
    }
  }

  private async advanceOrFinish(): Promise<void> {
    if (!this.room) return;

    this.room.currentQuestionIndex++;

    if (this.room.currentQuestionIndex < this.room.questions.length) {
      await this.sendCurrentQuestion();
    } else {
      await this.finishGame();
    }
  }

  private async finishGame(): Promise<void> {
    if (!this.room) return;

    this.room.phase = 'finished';
    this.room.nextAlarmAction = null;

    const rankings = [...this.room.players].sort(
      (a, b) => (this.room!.scores[b.id] || 0) - (this.room!.scores[a.id] || 0),
    );

    await this.persist();

    this.broadcast({
      type: 'game_finished',
      finalScores: this.room.scores,
      rankings,
    });
  }

  private async expireGame(): Promise<void> {
    if (!this.room) return;

    // Safety: only expire games still in the waiting phase
    if (this.room.phase !== 'waiting') return;

    // Notify connected clients
    this.broadcast({ type: 'game_expired', message: 'Game expired due to inactivity' });

    // Close all WebSocket connections
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.close(1000, 'Game expired');
      } catch {
        // Already closed
      }
    }

    // Remove from lobby
    const lobbyId = this.env.GAME_LOBBY.idFromName('global');
    const lobby = this.env.GAME_LOBBY.get(lobbyId);
    await lobby.fetch(
      new Request(`http://internal/games/${this.room.gameId}`, { method: 'DELETE' }),
    );

    // Clear room storage
    this.room = null;
    await this.state.storage.deleteAll();
  }

  // --- Helpers ---

  private getPlayerId(ws: WebSocket): string | null {
    return ws.deserializeAttachment() as string | null;
  }

  private pickAvatar(): Avatar {
    const usedNames = new Set(this.room!.players.map((p) => p.avatar.name));
    const available = AVATARS.filter((a) => !usedNames.has(a.name));
    const pool = available.length > 0 ? available : AVATARS; // fallback if all used
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private getClientGameState(): GameState {
    const r = this.room!;
    return {
      id: r.gameId,
      config: r.config,
      phase: r.phase,
      hostId: r.hostId,
      players: r.players,
      currentQuestionIndex: r.currentQuestionIndex,
      answers: r.answersThisRound,
      scores: r.scores,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
    };
  }

  private sendTo(ws: WebSocket, message: object): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Dead connection
    }
  }

  private broadcast(message: object): void {
    const json = JSON.stringify(message);
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(json);
      } catch {
        // Dead connection
      }
    }
  }

  private broadcastExcept(excludeWs: WebSocket, message: object): void {
    const json = JSON.stringify(message);
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      if (ws === excludeWs) continue;
      try {
        ws.send(json);
      } catch {
        // Dead connection
      }
    }
  }

  private async persist(): Promise<void> {
    await this.state.storage.put('room', this.room);
  }
}
