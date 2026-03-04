import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { RIDDLES, RIDDLE_MAX_GUESSES, isValidWord } from '@lamo-trivia/shared';
import { RiddleWordleGrid } from '../components/RiddleWordleGrid';
import { RiddleWordleKeyboard } from '../components/RiddleWordleKeyboard';
import { SEO } from '../components/SEO';
import { Button } from '../components/ui/Button';

export type LetterStatus = 'correct' | 'present' | 'absent';

type GameStatus = 'playing' | 'won' | 'lost';

const SEEN_KEY = 'riddle-wordle-seen';

function getSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function markSeen(id: string) {
  try {
    const seen = getSeenIds();
    seen.add(id);
    // Reset if all riddles have been seen
    if (seen.size >= RIDDLES.length) {
      localStorage.removeItem(SEEN_KEY);
    } else {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    }
  } catch {
    // localStorage unavailable — silently ignore
  }
}

function getRandomRiddle() {
  const seen = getSeenIds();
  const unseen = RIDDLES.filter((r) => !seen.has(r.id));
  const pool = unseen.length > 0 ? unseen : RIDDLES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function evaluateGuess(guess: string, answer: string): LetterStatus[] {
  const result: LetterStatus[] = Array(guess.length).fill('absent');
  const answerChars = answer.split('');
  const remaining: (string | null)[] = [...answerChars];

  // First pass: mark correct (green)
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answerChars[i]) {
      result[i] = 'correct';
      remaining[i] = null;
    }
  }

  // Second pass: mark present (yellow)
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'correct') continue;
    const idx = remaining.indexOf(guess[i]);
    if (idx !== -1) {
      result[i] = 'present';
      remaining[idx] = null;
    }
  }

  return result;
}

export default function RiddleWordle() {
  const [riddle, setRiddle] = useState(getRandomRiddle);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<LetterStatus[][]>([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameStatus, setGameStatus] = useState<GameStatus>('playing');
  const [showHint, setShowHint] = useState(false);
  const [shake, setShake] = useState(false);
  const [message, setMessage] = useState('');

  const answer = riddle.answer;
  const answerLength = answer.length;

  // Build cumulative letter statuses for keyboard coloring
  const letterStatuses: Record<string, LetterStatus> = {};
  for (let row = 0; row < guesses.length; row++) {
    for (let col = 0; col < guesses[row].length; col++) {
      const letter = guesses[row][col];
      const status = statuses[row][col];
      const existing = letterStatuses[letter];
      // Priority: correct > present > absent
      if (
        !existing ||
        status === 'correct' ||
        (status === 'present' && existing === 'absent')
      ) {
        letterStatuses[letter] = status;
      }
    }
  }

  const triggerShake = useCallback((msg: string) => {
    setMessage(msg);
    setShake(true);
    setTimeout(() => setShake(false), 600);
    setTimeout(() => setMessage(''), 2000);
  }, []);

  const handleKey = useCallback(
    (key: string) => {
      if (gameStatus !== 'playing') return;

      if (key === 'BACK') {
        setCurrentGuess((prev) => prev.slice(0, -1));
        return;
      }

      if (key === 'ENTER') {
        if (currentGuess.length !== answerLength) {
          triggerShake(`Must be ${answerLength} letters`);
          return;
        }

        const guess = currentGuess.toUpperCase();

        // Dictionary check: must be a real English word (always allow the actual answer)
        if (!isValidWord(guess) && guess !== answer) {
          triggerShake('Not a valid word');
          return;
        }

        const result = evaluateGuess(guess, answer);
        const newGuesses = [...guesses, guess];
        const newStatuses = [...statuses, result];

        setGuesses(newGuesses);
        setStatuses(newStatuses);
        setCurrentGuess('');

        if (guess === answer) {
          setGameStatus('won');
          setMessage('You solved it!');
          markSeen(riddle.id);
        } else if (newGuesses.length >= RIDDLE_MAX_GUESSES) {
          setGameStatus('lost');
          setMessage(`The answer was: ${answer}`);
          markSeen(riddle.id);
        }
        return;
      }

      // Regular letter
      if (/^[A-Z]$/.test(key) && currentGuess.length < answerLength) {
        setCurrentGuess((prev) => prev + key);
      }
    },
    [gameStatus, currentGuess, answerLength, answer, guesses, statuses, triggerShake],
  );

  // Physical keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        handleKey('ENTER');
      } else if (e.key === 'Backspace') {
        handleKey('BACK');
      } else {
        const letter = e.key.toUpperCase();
        if (/^[A-Z]$/.test(letter)) {
          handleKey(letter);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleKey]);

  const handleNewGame = () => {
    setRiddle(getRandomRiddle());
    setGuesses([]);
    setStatuses([]);
    setCurrentGuess('');
    setGameStatus('playing');
    setShowHint(false);
    setMessage('');
  };

  return (
    <>
      <SEO
        title="Riddle Wordle - LAMO Trivia"
        description="Solve family-friendly riddles Wordle-style! Read the riddle, guess the answer letter by letter. 5 guesses to get it right."
        keywords="riddle wordle, word game, riddle game, family word game, guess the riddle"
        canonical="https://lamotrivia.app/riddle-wordle"
      />
      <div className="max-w-xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="text-center mb-6">
          <Link
            to="/"
            className="text-xs text-lamo-blue hover:underline mb-2 inline-block"
          >
            &larr; Back to Home
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-lamo-dark">
            Riddle Wordle
          </h1>
          <p className="text-sm text-lamo-gray-muted mt-1">
            Solve the riddle, Wordle-style!
          </p>
        </div>

        {/* Riddle */}
        <div className="bg-lamo-bg border border-lamo-border rounded-2xl p-5 mb-6 text-center">
          <p className="text-lg font-medium text-lamo-dark leading-relaxed">
            {riddle.text}
          </p>
          <p className="text-xs text-lamo-gray-muted mt-2">
            Answer: {answerLength} letter{answerLength !== 1 ? 's' : ''}
            {' '}&middot;{' '}
            {RIDDLE_MAX_GUESSES - guesses.length} guess{RIDDLE_MAX_GUESSES - guesses.length !== 1 ? 'es' : ''} left
          </p>
          {riddle.hint && gameStatus === 'playing' && (
            <button
              onClick={() => setShowHint(true)}
              className="mt-2 text-xs text-lamo-blue hover:underline"
            >
              {showHint ? `Hint: ${riddle.hint}` : 'Show hint'}
            </button>
          )}
        </div>

        {/* Message banner */}
        {message && (
          <div
            className={`text-center text-sm font-medium mb-4 px-4 py-2 rounded-xl ${
              gameStatus === 'won'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : gameStatus === 'lost'
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
            }`}
          >
            {message}
          </div>
        )}

        {/* Grid */}
        <div className="mb-6">
          <RiddleWordleGrid
            guesses={guesses}
            statuses={statuses}
            currentGuess={currentGuess}
            answerLength={answerLength}
            maxGuesses={RIDDLE_MAX_GUESSES}
            shake={shake}
          />
        </div>

        {/* Keyboard or New Game */}
        {gameStatus === 'playing' ? (
          <RiddleWordleKeyboard
            letterStatuses={letterStatuses}
            onKey={handleKey}
            disabled={gameStatus !== 'playing'}
          />
        ) : (
          <div className="flex justify-center gap-3">
            <Button onClick={handleNewGame}>New Riddle</Button>
            <Button variant="secondary" onClick={() => window.location.assign('/')}>
              Home
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
