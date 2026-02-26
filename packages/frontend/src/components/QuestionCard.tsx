import type { ClientQuestion } from '@lamo-trivia/shared';

interface QuestionCardProps {
  question: ClientQuestion;
  questionIndex: number;
  totalQuestions: number;
  selectedAnswer: number | null;
  correctIndex?: number | null;
  showResult?: boolean;
  onAnswer: (answerIndex: number) => void;
}

export function QuestionCard({
  question,
  questionIndex,
  totalQuestions,
  selectedAnswer,
  correctIndex,
  showResult,
  onAnswer,
}: QuestionCardProps) {
  const getButtonClass = (i: number) => {
    const base = 'px-5 py-3.5 rounded-xl text-left font-medium transition-colors border';

    if (showResult && correctIndex !== null && correctIndex !== undefined) {
      if (i === correctIndex) {
        return `${base} bg-green-500 text-white border-green-500`;
      }
      if (selectedAnswer === i && i !== correctIndex) {
        return `${base} bg-red-500 text-white border-red-500`;
      }
      return `${base} bg-lamo-bg-hero text-lamo-dark border-lamo-border opacity-60`;
    }

    if (selectedAnswer === i) {
      return `${base} bg-lamo-blue text-white border-lamo-blue`;
    }
    return `${base} bg-lamo-bg-hero text-lamo-dark border-lamo-border hover:border-lamo-blue/40`;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <p className="text-sm text-lamo-gray-muted mb-2">
        Question {questionIndex + 1} of {totalQuestions}
      </p>
      <h3 className="text-xl font-bold text-lamo-dark mb-6">{question.text}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {question.options.map((option, i) => (
          <button
            key={i}
            onClick={() => onAnswer(i)}
            disabled={!!showResult}
            className={getButtonClass(i)}
          >
            {option}
          </button>
        ))}
      </div>
      {showResult && (
        <p className={`mt-4 text-center font-semibold ${
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
