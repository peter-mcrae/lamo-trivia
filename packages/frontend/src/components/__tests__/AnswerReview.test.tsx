import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Player, QuestionReview } from '@lamo-trivia/shared';
import { AnswerReview } from '../AnswerReview';

const players: Player[] = [
  { id: 'p1', username: 'Alice', avatar: { emoji: '🐕', name: 'Dog' }, connectedAt: 0, score: 0 },
  { id: 'p2', username: 'Bob', avatar: { emoji: '🐈', name: 'Cat' }, connectedAt: 0, score: 0 },
];

const review: QuestionReview[] = [
  {
    questionIndex: 0,
    question: { id: 'q1', text: 'Capital of France?', options: ['Rome', 'Paris', 'Bonn', 'Oslo'], categoryId: 'geo' },
    correctIndex: 1,
    answers: { p1: 1, p2: 3 },
  },
  {
    questionIndex: 1,
    question: { id: 'q2', text: 'Largest ocean?', options: ['Pacific', 'Atlantic', 'Indian', 'Arctic'], categoryId: 'geo' },
    correctIndex: 0,
    answers: { p2: 0 },
  },
];

describe('AnswerReview', () => {
  it('lists every played question with its options', () => {
    render(<AnswerReview review={review} players={players} playerId="p1" />);

    expect(screen.getByText('Capital of France?')).toBeInTheDocument();
    expect(screen.getByText('Largest ocean?')).toBeInTheDocument();
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(screen.getByText('Rome')).toBeInTheDocument();
    expect(screen.getByText('Arctic')).toBeInTheDocument();
  });

  it('marks the correct answer on every question', () => {
    render(<AnswerReview review={review} players={players} playerId="p1" />);

    const checks = screen.getAllByLabelText('Correct answer');
    expect(checks).toHaveLength(2);
  });

  it('summarises how many the viewing player got right', () => {
    render(<AnswerReview review={review} players={players} playerId="p1" />);

    // p1 answered q1 correctly and skipped q2
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/of 2 right/)).toBeInTheDocument();
  });

  it('labels the viewing player\'s result per question', () => {
    render(<AnswerReview review={review} players={players} playerId="p2" />);

    // p2 got q1 wrong and q2 right
    expect(screen.getByText('You missed it')).toBeInTheDocument();
    expect(screen.getByText('You got it')).toBeInTheDocument();
  });

  it('shows "No answer" for a question the player skipped', () => {
    render(<AnswerReview review={review} players={players} playerId="p1" />);

    expect(screen.getByText('No answer')).toBeInTheDocument();
    expect(screen.getByText(/No answer: 🐕 Alice/)).toBeInTheDocument();
  });

  it('flags the option the player picked when it was wrong', () => {
    render(<AnswerReview review={review} players={players} playerId="p2" />);

    expect(screen.getByText('your pick')).toBeInTheDocument();
  });

  it('renders without a viewing player (spectator / unknown id)', () => {
    render(<AnswerReview review={review} players={players} playerId={null} />);

    expect(screen.getByText('Capital of France?')).toBeInTheDocument();
    expect(screen.queryByText(/of 2 right/)).not.toBeInTheDocument();
    expect(screen.queryByText('You got it')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no review data', () => {
    const { container } = render(<AnswerReview review={[]} players={players} playerId="p1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
