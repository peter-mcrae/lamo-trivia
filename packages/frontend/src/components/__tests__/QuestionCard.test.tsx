import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionCard } from '../QuestionCard';

// Mock canvas-confetti to avoid DOM canvas errors in jsdom
vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

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
