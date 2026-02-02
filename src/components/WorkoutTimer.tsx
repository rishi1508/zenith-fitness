import { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';

interface WorkoutTimerProps {
  startTime: string;
}

export function WorkoutTimer({ startTime }: WorkoutTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startTime).getTime();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <div className="flex items-center gap-2 text-orange-400">
      <Timer className="w-4 h-4" />
      <span className="font-mono">{mins}:{secs.toString().padStart(2, '0')}</span>
    </div>
  );
}
