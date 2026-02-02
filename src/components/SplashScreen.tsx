import { Flame } from 'lucide-react';

export function SplashScreen() {
  return (
    <div className="fixed inset-0 bg-[#0f0f0f] flex flex-col items-center justify-center z-50">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center mb-4 animate-pulse shadow-lg shadow-orange-500/20">
        <Flame className="w-10 h-10 text-white" />
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">Zenith Fitness</h1>
      <p className="text-zinc-500 text-sm">Track. Improve. Dominate.</p>
      <div className="flex gap-1 mt-6">
        <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}
