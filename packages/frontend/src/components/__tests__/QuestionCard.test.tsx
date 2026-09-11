import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import confetti from 'canvas-confetti';
import { QuestionCard } from '../QuestionCard';

// Mock canvas-confetti to avoid DOM canvas errors in jsdom. QuestionCard calls
// confetti.create(...) to get an instance with useWorker disabled (see
// QuestionCard.tsx), so the mocked default export needs a `create` method too.
vi.mock('canvas-confetti', () => {
  const fire = vi.fn();
  const confetti = Object.assign(vi.fn(), { create: vi.fn(() => fire) });
  return { default: confetti };
});

const sampleQuestion = {
  id: 'q1',
  text: 'What is the capital of France?',
  options: ['London', 'Berlin', 'Paris', 'Madrid'],
  categoryId: 'geography',
};

const defaultProps = {
  question: sampleQuestion,
  questionIndex: 2,
  totalQuestions: 10,
  selectedAnswer: null as number | null,
  onAnswer: vi.fn(),
};

describe('QuestionCard', () => {
  it('renders question text and all 4 options', () => {
    render(<QuestionCard {...defaultProps} />);

    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Madrid')).toBeInTheDocument();
  });

  it('renders question number (1-indexed)', () => {
    render(<QuestionCard {...defaultProps} />);

    // questionIndex=2 → "Question 3 of 10"
    expect(screen.getByText(/Question 3 of 10/)).toBeInTheDocument();
  });

  it('clicking an option calls onAnswer with correct index', () => {
    const onAnswer = vi.fn();
    render(<QuestionCard {...defaultProps} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText('Paris'));
    expect(onAnswer).toHaveBeenCalledWith(2);
  });

  it('selected answer has distinct styling class', () => {
    render(<QuestionCard {...defaultProps} selectedAnswer={2} />);

    const parisButton = screen.getByText('Paris').closest('button')!;
    expect(parisButton.className).toContain('bg-lamo-blue');
  });

  it('shows "Correct!" when result is correct', () => {
    render(
      <QuestionCard
        {...defaultProps}
        selectedAnswer={2}
        correctIndex={2}
        showResult={true}
      />,
    );

    expect(screen.getByText('Correct!')).toBeInTheDocument();
  });

  it('shows "Wrong!" when result is incorrect', () => {
    render(
      <QuestionCard
        {...defaultProps}
        selectedAnswer={0}
        correctIndex={2}
        showResult={true}
      />,
    );

    expect(screen.getByText('Wrong!')).toBeInTheDocument();
  });

  it('buttons are disabled in result mode', () => {
    render(
      <QuestionCard
        {...defaultProps}
        selectedAnswer={2}
        correctIndex={2}
        showResult={true}
      />,
    );

    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });
});

describe('QuestionCard — confetti under the production CSP', () => {
  it('fires through a create()d instance with useWorker off, never the bare export', () => {
    render(
      <QuestionCard
        {...defaultProps}
        selectedAnswer={2}
        correctIndex={2}
        showResult={true}
      />,
    );

    // `useWorker` is only honoured by confetti.create(canvas, globalOpts), at
    // instance-creation time. The bare default export is a hardcoded
    // useWorker:true singleton whose off-thread Worker the production CSP
    // (packages/frontend/public/_headers — no worker-src, no blob:) blocks, so
    // going through it means confetti silently never renders. @types/canvas-confetti
    // does not even declare `useWorker` on the per-call `Options`, so passing it
    // to an individual confetti() call is a no-op that would not compile either.
    const create = vi.mocked(confetti.create);
    expect(create).toHaveBeenCalled();
    expect(create.mock.calls[0][1]).toMatchObject({ useWorker: false });

    // ...and the instance create() handed back is what actually fires
    expect(create.mock.results[0].value).toHaveBeenCalledWith(
      expect.objectContaining({ particleCount: 70 }),
    );
    expect(vi.mocked(confetti)).not.toHaveBeenCalled();
  });
});
