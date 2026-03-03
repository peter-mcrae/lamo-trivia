import type { LetterStatus } from '../pages/RiddleWordle';

interface RiddleWordleKeyboardProps {
  letterStatuses: Record<string, LetterStatus>;
  onKey: (key: string) => void;
  disabled: boolean;
}

const ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK'],
];

export function RiddleWordleKeyboard({ letterStatuses, onKey, disabled }: RiddleWordleKeyboardProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {ROWS.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-1">
          {row.map((key) => {
            const isSpecial = key === 'ENTER' || key === 'BACK';
            const status = !isSpecial ? letterStatuses[key] : undefined;

            return (
              <button
                key={key}
                onClick={() => onKey(key)}
                disabled={disabled}
                className={`${
                  isSpecial ? 'px-3 sm:px-4' : 'w-8 sm:w-10'
                } h-12 sm:h-14 flex items-center justify-center text-sm sm:text-base font-semibold rounded-lg transition-colors ${
                  disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'active:scale-95'
                } ${getKeyStyle(status)}`}
              >
                {key === 'BACK' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path
                      fillRule="evenodd"
                      d="M2.515 10.674a1.875 1.875 0 000 2.652L8.89 19.7c.352.351.829.549 1.326.549H19.5a3 3 0 003-3V6.75a3 3 0 00-3-3h-9.284c-.497 0-.974.198-1.326.55l-6.375 6.374zM12.53 9.22a.75.75 0 10-1.06 1.06L13.19 12l-1.72 1.72a.75.75 0 101.06 1.06l1.72-1.72 1.72 1.72a.75.75 0 101.06-1.06L15.31 12l1.72-1.72a.75.75 0 00-1.06-1.06l-1.72 1.72-1.72-1.72z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  key
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function getKeyStyle(status?: LetterStatus): string {
  switch (status) {
    case 'correct':
      return 'bg-green-500 text-white border border-green-600';
    case 'present':
      return 'bg-yellow-500 text-white border border-yellow-600';
    case 'absent':
      return 'bg-gray-400 text-white border border-gray-500';
    default:
      return 'bg-gray-200 text-lamo-dark border border-gray-300 hover:bg-gray-300';
  }
}
