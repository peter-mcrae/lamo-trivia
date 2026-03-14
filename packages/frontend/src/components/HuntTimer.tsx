import { useEffect, useState } from 'react';

interface HuntTimerProps {
  endsAt: number;
}

export function HuntTimer({ endsAt }: HuntTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  });

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const isUrgent = secondsLeft < 60;
  const isWarning = secondsLeft < 300 && !isUrgent;

  let colorClass = 'text-lamo-dark';
  let bgClass = 'bg-lamo-bg border-lamo-border';
  if (isUrgent) {
    colorClass = 'text-red-600';
    bgClass = 'bg-red-50 border-red-200';
  } else if (isWarning) {
    colorClass = 'text-amber-600';
    bgClass = 'bg-amber-50 border-amber-200';
  }

  return (
    <div className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl border ${bgClass}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`w-5 h-5 ${colorClass}`}
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
          clipRule="evenodd"
        />
      </svg>
      <span className={`text-xl font-bold tabular-nums ${colorClass} ${isUrgent ? 'animate-pulse' : ''}`}>
        {formatted}
      </span>
    </div>
  );
}
