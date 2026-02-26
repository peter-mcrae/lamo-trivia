import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBoard } from '../ScoreBoard';

const makePlayers = () => [
  {
    id: 'p1',
    username: 'Alice',
    avatar: { emoji: '🐕', name: 'Golden Retriever' },
    connectedAt: Date.now(),
    score: 0,
  },
  {
    id: 'p2',
    username: 'Bob',
    avatar: { emoji: '🐈', name: 'Cat' },
    connectedAt: Date.now(),
    score: 0,
  },
  {
    id: 'p3',
    username: 'Charlie',
    avatar: { emoji: '🐢', name: 'Turtle' },
    connectedAt: Date.now(),
    score: 0,
  },
];

describe('ScoreBoard', () => {
  it('sorts players by score descending', () => {
    const players = makePlayers();
    const scores = { p1: 50, p2: 200, p3: 100 };

    render(<ScoreBoard players={players} scores={scores} />);

    const names = screen.getAllByText(/Alice|Bob|Charlie/);
    expect(names[0].textContent).toBe('Bob');
    expect(names[1].textContent).toBe('Charlie');
    expect(names[2].textContent).toBe('Alice');
  });

  it('displays all player names', () => {
    const players = makePlayers();
    const scores = { p1: 10, p2: 20, p3: 30 };

    render(<ScoreBoard players={players} scores={scores} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('handles players with zero or missing scores', () => {
    const players = makePlayers();
    const scores: Record<string, number> = { p2: 100 };

    render(<ScoreBoard players={players} scores={scores} />);

    // Bob (100) should be first, then Alice and Charlie both at 0
    const names = screen.getAllByText(/Alice|Bob|Charlie/);
    expect(names[0].textContent).toBe('Bob');

    // p1 and p3 have no scores, should display 0
    const zeroScores = screen.getAllByText('0');
    expect(zeroScores.length).toBe(2);
  });
});
