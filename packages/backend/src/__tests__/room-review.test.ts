import { describe, it, expect } from 'vitest';
import { GameRoom } from '../room';
import {
  createMockDurableObjectState,
  createMockWebSocket,
  createMockEnv,
  getSentMessages,
} from './mocks';

const QUESTIONS = [
  { id: 'q1', text: 'Q1?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, categoryId: 'general' },
  { id: 'q2', text: 'Q2?', options: ['e', 'f', 'g', 'h'], correctIndex: 0, categoryId: 'general' },
];

async function createPlayingRoom() {
  const state = createMockDurableObjectState();
  const env = createMockEnv();
  const now = Date.now();
  state._storage.set('room', {
    gameId: 'TEST-0001',
    config: {
      name: 'Test Game',
      categoryIds: ['general'],
      questionCount: 2,
      minPlayers: 1,
      maxPlayers: 8,
      timePerQuestion: 15,
      scoringMethod: 'correct-only',
      streakBonus: false,
      showAnswers: false,
      timeBetweenQuestions: 5,
      isPrivate: false,
    },
    phase: 'playing',
    hostId: 'p1',
    players: [
      { id: 'p1', username: 'alice', avatar: { emoji: '🐕', name: 'Dog' }, connectedAt: now, score: 0 },
      { id: 'p2', username: 'bob', avatar: { emoji: '🐈', name: 'Cat' }, connectedAt: now, score: 0 },
    ],
    questions: QUESTIONS,
    currentQuestionIndex: 0,
    scores: { p1: 0, p2: 0 },
    streaks: { p1: 0, p2: 0 },
    answersThisRound: { p1: 1, p2: 3 },
    answerTimesThisRound: { p1: now, p2: now },
    answersByQuestion: {},
    questionStartedAt: now - 1000,
    lastScoredQuestionIndex: -1,
    nextAlarmAction: 'end_question',
    createdAt: now,
    rejoinTokens: { p1: 'token-p1' },
  });
  const room = new GameRoom(state, env);
  // Let blockConcurrencyWhile load the stored state
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { room, state };
}

/** Play both questions to completion: p1 answers 1 then 2, p2 answers 3 then 0. */
async function playToFinish(room: GameRoom) {
  await (room as any).endCurrentQuestion();
  (room as any).room.currentQuestionIndex = 1;
  (room as any).room.answersThisRound = { p1: 2, p2: 0 };
  (room as any).room.answerTimesThisRound = { p1: Date.now(), p2: Date.now() };
  await (room as any).endCurrentQuestion();
}

describe('GameRoom post-game answer review', () => {
  it('snapshots each round\'s answers as questions end', async () => {
    const { room, state } = await createPlayingRoom();

    await playToFinish(room);

    const stored = state._storage.get('room') as any;
    expect(stored.answersByQuestion[0]).toEqual({ p1: 1, p2: 3 });
    expect(stored.answersByQuestion[1]).toEqual({ p1: 2, p2: 0 });
  });

  it('re-running endCurrentQuestion (alarm retry) does not corrupt the snapshot', async () => {
    const { room, state } = await createPlayingRoom();

    await (room as any).endCurrentQuestion();
    // Alarm retries land after answersThisRound would normally have been reset
    (room as any).room.answersThisRound = {};
    await (room as any).endCurrentQuestion();

    const stored = state._storage.get('room') as any;
    expect(stored.answersByQuestion[0]).toEqual({ p1: 1, p2: 3 });
  });

  it('sends the full answer key with game_finished', async () => {
    const { room, state } = await createPlayingRoom();
    const ws = createMockWebSocket();
    ws.serializeAttachment('p1');
    state.acceptWebSocket(ws);

    await playToFinish(room);
    await (room as any).finishGame();

    const finished = getSentMessages(ws).find((m) => m.type === 'game_finished');
    expect(finished.review).toHaveLength(2);
    expect(finished.review[0]).toEqual({
      questionIndex: 0,
      question: { id: 'q1', text: 'Q1?', options: ['a', 'b', 'c', 'd'], categoryId: 'general' },
      correctIndex: 1,
      answers: { p1: 1, p2: 3 },
    });
    expect(finished.review[1].correctIndex).toBe(0);
    expect(finished.review[1].answers).toEqual({ p1: 2, p2: 0 });
  });

  it('includes the review in game_state when a player rejoins a finished game', async () => {
    const { room, state } = await createPlayingRoom();

    await playToFinish(room);
    await (room as any).finishGame();

    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await room.webSocketMessage(
      ws,
      JSON.stringify({
        type: 'rejoin_game',
        gameId: 'TEST-0001',
        username: 'alice',
        rejoinToken: 'token-p1',
      }),
    );

    const stateMsg = getSentMessages(ws).find((m) => m.type === 'game_state');
    expect(stateMsg.state.phase).toBe('finished');
    expect(stateMsg.state.review).toHaveLength(2);
    expect(stateMsg.state.review[0].correctIndex).toBe(1);
  });

  it('never leaks correct answers while the game is still playing', async () => {
    const { room, state } = await createPlayingRoom();

    const ws = createMockWebSocket();
    state.acceptWebSocket(ws);
    await room.webSocketMessage(
      ws,
      JSON.stringify({
        type: 'rejoin_game',
        gameId: 'TEST-0001',
        username: 'alice',
        rejoinToken: 'token-p1',
      }),
    );

    const stateMsg = getSentMessages(ws).find((m) => m.type === 'game_state');
    expect(stateMsg.state.review).toBeUndefined();
    // The resent question must still be the answer-free client shape
    const questionMsg = getSentMessages(ws).find((m) => m.type === 'question');
    expect(questionMsg.question.correctIndex).toBeUndefined();
  });

  it('withholds the answer key from sockets that never joined', async () => {
    const { room, state } = await createPlayingRoom();

    // A lurker opens the WebSocket upgrade but is refused by both join paths
    const lurker = createMockWebSocket();
    state.acceptWebSocket(lurker);
    await room.webSocketMessage(
      lurker,
      JSON.stringify({ type: 'join_game', gameId: 'TEST-0001', username: 'mallory' }),
    );
    await room.webSocketMessage(
      lurker,
      JSON.stringify({
        type: 'rejoin_game',
        gameId: 'TEST-0001',
        username: 'alice',
        rejoinToken: 'guessed-token',
      }),
    );

    const player = createMockWebSocket();
    player.serializeAttachment('p1');
    state.acceptWebSocket(player);

    await playToFinish(room);
    await (room as any).finishGame();

    // The player gets the review; the unattached socket gets nothing with it
    expect(getSentMessages(player).find((m) => m.type === 'game_finished').review).toHaveLength(2);
    const lurkerMessages = getSentMessages(lurker);
    expect(lurkerMessages.some((m) => m.type === 'game_finished')).toBe(false);
    expect(JSON.stringify(lurkerMessages)).not.toContain('correctIndex');
  });

  it('only reviews questions that were actually played', async () => {
    const { room } = await createPlayingRoom();

    // Finish after just the first question (defensive: an early end shouldn't
    // reveal answers to questions nobody saw)
    await (room as any).endCurrentQuestion();
    const review = (room as any).buildReview();

    expect(review).toHaveLength(1);
    expect(review[0].question.id).toBe('q1');
  });

  it('backfills answersByQuestion for rooms persisted before the feature', async () => {
    const state = createMockDurableObjectState();
    const env = createMockEnv();
    const now = Date.now();
    state._storage.set('room', {
      gameId: 'TEST-0002',
      config: { name: 'Old', categoryIds: ['general'], questionCount: 1, minPlayers: 1, maxPlayers: 8, timePerQuestion: 15, scoringMethod: 'correct-only', streakBonus: false, showAnswers: false, timeBetweenQuestions: 5, isPrivate: false },
      phase: 'playing',
      hostId: 'p1',
      players: [{ id: 'p1', username: 'alice', avatar: { emoji: '🐕', name: 'Dog' }, connectedAt: now, score: 0 }],
      questions: [QUESTIONS[0]],
      currentQuestionIndex: 0,
      scores: { p1: 0 },
      streaks: { p1: 0 },
      answersThisRound: { p1: 1 },
      answerTimesThisRound: { p1: now },
      questionStartedAt: now - 1000,
      lastScoredQuestionIndex: -1,
      nextAlarmAction: 'end_question',
      createdAt: now,
      // answersByQuestion absent — this room predates the review feature
    });
    const room = new GameRoom(state, env);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await (room as any).endCurrentQuestion();

    const stored = state._storage.get('room') as any;
    expect(stored.answersByQuestion[0]).toEqual({ p1: 1 });
  });
});
