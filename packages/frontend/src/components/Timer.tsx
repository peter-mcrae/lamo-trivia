interface TimerProps {
  seconds: number;
  total: number;
}

export function Timer({ seconds, total }: TimerProps) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (seconds / total) * 100)) : 0;
  const urgent = seconds <= 5;

  return (
    <div className="game-timer w-full">
      <div className="flex justify-between items-center mb-2">
        <span className="eyebrow">MAKE YOUR GUESS</span>
        <span className={`text-sm font-semibold ${urgent ? 'text-red-500' : 'text-lamo-dark'}`}>
          {seconds}s
        </span>
      </div>
      <div role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={Math.max(1, total)} aria-valuenow={Math.max(0, Math.min(seconds, total))} aria-valuetext={`${seconds} seconds remaining`} className="h-2 bg-lamo-bg rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${urgent ? 'bg-red-500' : 'bg-lamo-lime'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
