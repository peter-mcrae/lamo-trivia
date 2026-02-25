interface TimerProps {
  seconds: number;
  total: number;
}

export function Timer({ seconds, total }: TimerProps) {
  const pct = (seconds / total) * 100;
  const urgent = seconds <= 5;

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className={`text-sm font-semibold ${urgent ? 'text-red-500' : 'text-lamo-dark'}`}>
          {seconds}s
        </span>
      </div>
      <div className="h-2 bg-lamo-bg rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${urgent ? 'bg-red-500' : 'bg-lamo-lime'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
