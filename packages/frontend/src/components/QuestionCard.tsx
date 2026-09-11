import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import type { ClientQuestion } from '@lamo-trivia/shared';

interface QuestionCardProps {
  question: ClientQuestion;
  questionIndex: number;
  totalQuestions: number;
  selectedAnswer: number | null;
  correctIndex?: number | null;
  showResult?: boolean;
  isCorrect?: boolean;
  onAnswer: (answerIndex: number) => void;
}

export function QuestionCard({
  question,
  questionIndex,
  totalQuestions,
  selectedAnswer,
  correctIndex,
  showResult,
  isCorrect,
  onAnswer,
}: QuestionCardProps) {
  useEffect(() => {
    if (showResult && selectedAnswer !== null && (isCorrect || selectedAnswer === correctIndex) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#234ee8', '#5dcdd7', '#102342', '#ffffff'],
      });
    }
  }, [showResult, selectedAnswer, correctIndex, isCorrect]);

  const getButtonClass = (i: number) => {
    const base = 'answer-choice px-5 py-3.5 rounded-xl text-left font-medium transition-colors border';

    if (showResult && correctIndex !== null && correctIndex !== undefined) {
      if (i === correctIndex) {
        return `${base} bg-green-700 text-white border-green-700`;
      }
      if (selectedAnswer === i && i !== correctIndex) {
        return `${base} bg-red-700 text-white border-red-700`;
      }
      return `${base} bg-lamo-bg-hero text-lamo-dark border-lamo-border opacity-60`;
    }

    if (selectedAnswer === i) {
      return `${base} bg-lamo-blue text-white border-lamo-blue`;
    }
    return `${base} bg-lamo-bg-hero text-lamo-dark border-lamo-border hover:border-lamo-blue/40`;
  };

  return (
    <div className="question-card max-w-2xl mx-auto">
      <p className="text-sm text-lamo-gray-muted mb-2">
        Question {questionIndex + 1} of {totalQuestions}
      </p>
      <h3 className="question-title text-xl font-bold text-lamo-dark mb-6">{question.text}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {question.options.map((option, i) => (
          <button
            key={i}
            onClick={() => onAnswer(i)}
            disabled={!!showResult}
            aria-pressed={selectedAnswer === i}
            className={getButtonClass(i)}
          >
            <span className="answer-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
            <span>{option}</span>
            {showResult && i === correctIndex && <span className="answer-status" aria-label="Correct answer">✓</span>}
            {showResult && selectedAnswer === i && i !== correctIndex && <span className="answer-status" aria-label="Incorrect answer">×</span>}
          </button>
        ))}
      </div>
      {showResult && (
        <p role="status" className={`mt-4 text-center font-semibold ${
          selectedAnswer === correctIndex ? 'text-green-600' : 'text-red-500'
        }`}>
          {selectedAnswer === null
            ? "Time's up!"
            : selectedAnswer === correctIndex
              ? 'Correct!'
              : 'Wrong!'}
        </p>
      )}
    </div>
  );
}
