import type { LetterStatus } from '../pages/RiddleWordle';

interface RiddleWordleGridProps {
  guesses: string[];
  statuses: LetterStatus[][];
  currentGuess: string;
  answerLength: number;
  maxGuesses: number;
  shake: boolean;
}

export function RiddleWordleGrid({
  guesses,
  statuses,
  currentGuess,
  answerLength,
  maxGuesses,
  shake,
}: RiddleWordleGridProps) {
  const emptyRows = maxGuesses - guesses.length - 1;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Submitted guesses */}
      {guesses.map((guess, rowIndex) => (
        <div key={rowIndex} className="flex gap-1.5">
          {guess.split('').map((letter, colIndex) => {
            const status = statuses[rowIndex]?.[colIndex] ?? 'absent';
            return (
              <div
                key={colIndex}
                className={`w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center text-xl font-bold rounded-lg border-2 uppercase transition-all duration-300 ${statusStyles[status]}`}
                style={{ animationDelay: `${colIndex * 100}ms` }}
              >
                {letter}
              </div>
            );
          })}
        </div>
      ))}

      {/* Current guess row */}
      {guesses.length < maxGuesses && (
        <div className={`flex gap-1.5 ${shake ? 'animate-shake' : ''}`}>
          {Array.from({ length: answerLength }).map((_, colIndex) => {
            const letter = currentGuess[colIndex] ?? '';
            return (
              <div
                key={colIndex}
                className={`w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center text-xl font-bold rounded-lg border-2 uppercase transition-all ${
                  letter
                    ? 'border-lamo-dark bg-white scale-105'
                    : 'border-lamo-border bg-white'
                }`}
              >
                {letter}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty future rows */}
      {emptyRows > 0 &&
        Array.from({ length: emptyRows }).map((_, rowIndex) => (
          <div key={`empty-${rowIndex}`} className="flex gap-1.5">
            {Array.from({ length: answerLength }).map((_, colIndex) => (
              <div
                key={colIndex}
                className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-lg border-2 border-lamo-border bg-white"
              />
            ))}
          </div>
        ))}
    </div>
  );
}

const statusStyles: Record<string, string> = {
  correct: 'bg-green-500 border-green-500 text-white',
  present: 'bg-yellow-500 border-yellow-500 text-white',
  absent: 'bg-gray-400 border-gray-400 text-white',
};
