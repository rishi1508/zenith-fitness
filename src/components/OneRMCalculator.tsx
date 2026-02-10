import { useState, useMemo } from 'react';
import { X, Trophy, ChevronDown, ChevronUp, Info } from 'lucide-react';

interface OneRMCalculatorProps {
  onClose: () => void;
  initialWeight?: number;
  initialReps?: number;
  isDark: boolean;
}

// Different 1RM formulas
const formulas = {
  epley: (w: number, r: number) => r === 1 ? w : w * (1 + r / 30),
  brzycki: (w: number, r: number) => r === 1 ? w : w * (36 / (37 - r)),
  lombardi: (w: number, r: number) => r === 1 ? w : w * Math.pow(r, 0.10),
  oconner: (w: number, r: number) => r === 1 ? w : w * (1 + 0.025 * r),
};

// Reverse calculation: what weight for X reps at given 1RM
const weightForReps = (oneRM: number, reps: number) => {
  if (reps === 1) return oneRM;
  // Using Epley formula reversed: weight = 1RM / (1 + reps/30)
  return oneRM / (1 + reps / 30);
};

export function OneRMCalculator({ onClose, initialWeight = 60, initialReps = 5, isDark }: OneRMCalculatorProps) {
  const [weight, setWeight] = useState(initialWeight);
  const [reps, setReps] = useState(initialReps);
  const [showFormulas, setShowFormulas] = useState(false);

  const results = useMemo(() => {
    if (weight <= 0 || reps <= 0) return null;
    
    return {
      epley: Math.round(formulas.epley(weight, reps)),
      brzycki: Math.round(formulas.brzycki(weight, reps)),
      lombardi: Math.round(formulas.lombardi(weight, reps)),
      oconner: Math.round(formulas.oconner(weight, reps)),
    };
  }, [weight, reps]);

  // Average of all formulas
  const averageOneRM = useMemo(() => {
    if (!results) return 0;
    return Math.round((results.epley + results.brzycki + results.lombardi + results.oconner) / 4);
  }, [results]);

  // Weight recommendations for different rep ranges
  const recommendations = useMemo(() => {
    if (averageOneRM <= 0) return [];
    return [
      { reps: 1, weight: averageOneRM, label: '1RM (Max)', intensity: '100%' },
      { reps: 3, weight: Math.round(weightForReps(averageOneRM, 3)), label: 'Heavy (3)', intensity: '93%' },
      { reps: 5, weight: Math.round(weightForReps(averageOneRM, 5)), label: 'Strength (5)', intensity: '87%' },
      { reps: 8, weight: Math.round(weightForReps(averageOneRM, 8)), label: 'Hypertrophy (8)', intensity: '80%' },
      { reps: 10, weight: Math.round(weightForReps(averageOneRM, 10)), label: 'Volume (10)', intensity: '75%' },
      { reps: 12, weight: Math.round(weightForReps(averageOneRM, 12)), label: 'Endurance (12)', intensity: '71%' },
    ];
  }, [averageOneRM]);

  const quickReps = [1, 3, 5, 8, 10, 12];

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className={`w-full max-w-md rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}>
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between sticky top-0 ${isDark ? 'border-[#2e2e2e] bg-[#1a1a1a]' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <h2 className="text-lg font-bold">1RM Calculator</h2>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Weight Input */}
          <div>
            <label className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Weight Lifted (kg)</label>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setWeight(Math.max(0, weight - 2.5))}
                className={`px-4 py-2 rounded-lg font-bold text-lg ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}
              >
                −
              </button>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(Math.max(0, parseFloat(e.target.value) || 0))}
                className={`flex-1 text-center text-2xl font-bold py-2 rounded-lg border ${
                  isDark ? 'bg-[#252525] border-[#3e3e3e]' : 'bg-gray-50 border-gray-200'
                } focus:outline-none focus:border-yellow-500`}
              />
              <button
                onClick={() => setWeight(weight + 2.5)}
                className={`px-4 py-2 rounded-lg font-bold text-lg ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}
              >
                +
              </button>
            </div>
          </div>

          {/* Reps Input */}
          <div>
            <label className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Reps Performed</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {quickReps.map(r => (
                <button
                  key={r}
                  onClick={() => setReps(r)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    reps === r
                      ? 'bg-yellow-500 text-white'
                      : isDark ? 'bg-[#252525] text-zinc-300' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {r}
                </button>
              ))}
              <input
                type="number"
                value={reps}
                onChange={(e) => setReps(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
                placeholder="Custom"
                className={`w-20 text-center py-2 rounded-lg border ${
                  isDark ? 'bg-[#252525] border-[#3e3e3e]' : 'bg-gray-50 border-gray-200'
                } focus:outline-none focus:border-yellow-500`}
              />
            </div>
          </div>

          {/* Main Result */}
          {results && (
            <div className={`bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 border border-yellow-500/30 rounded-xl p-4 ${!isDark && 'from-yellow-100 to-yellow-50'}`}>
              <div className="text-center">
                <div className={`text-sm mb-1 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>Estimated 1RM</div>
                <div className="text-5xl font-bold text-yellow-500">{averageOneRM}kg</div>
                <div className={`text-xs mt-2 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                  Based on {weight}kg × {reps} reps
                </div>
              </div>
            </div>
          )}

          {/* Weight Recommendations */}
          {recommendations.length > 0 && (
            <div className={`rounded-xl p-4 ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}>
              <div className={`text-sm font-medium mb-3 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
                Weight for Different Rep Ranges
              </div>
              <div className="space-y-2">
                {recommendations.map((rec, i) => (
                  <div key={i} className={`flex items-center justify-between py-2 ${i < recommendations.length - 1 ? `border-b ${isDark ? 'border-[#3e3e3e]' : 'border-gray-300'}` : ''}`}>
                    <div>
                      <span className="font-medium">{rec.label}</span>
                      <span className={`ml-2 text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                        {rec.intensity}
                      </span>
                    </div>
                    <div className="font-bold text-yellow-500">{rec.weight}kg</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Formula Details (Collapsible) */}
          <button
            onClick={() => setShowFormulas(!showFormulas)}
            className={`w-full flex items-center justify-between p-3 rounded-lg ${isDark ? 'bg-[#252525] text-zinc-400' : 'bg-gray-100 text-gray-600'}`}
          >
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4" />
              <span className="text-sm">Formula Comparison</span>
            </div>
            {showFormulas ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showFormulas && results && (
            <div className={`rounded-xl p-4 space-y-2 ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}>
              <div className="flex justify-between">
                <span className={isDark ? 'text-zinc-400' : 'text-gray-600'}>Epley</span>
                <span className="font-medium">{results.epley}kg</span>
              </div>
              <div className="flex justify-between">
                <span className={isDark ? 'text-zinc-400' : 'text-gray-600'}>Brzycki</span>
                <span className="font-medium">{results.brzycki}kg</span>
              </div>
              <div className="flex justify-between">
                <span className={isDark ? 'text-zinc-400' : 'text-gray-600'}>Lombardi</span>
                <span className="font-medium">{results.lombardi}kg</span>
              </div>
              <div className="flex justify-between">
                <span className={isDark ? 'text-zinc-400' : 'text-gray-600'}>O'Conner</span>
                <span className="font-medium">{results.oconner}kg</span>
              </div>
              <div className={`pt-2 mt-2 border-t flex justify-between ${isDark ? 'border-[#3e3e3e]' : 'border-gray-300'}`}>
                <span className="font-medium">Average</span>
                <span className="font-bold text-yellow-500">{averageOneRM}kg</span>
              </div>
            </div>
          )}

          {/* Info Text */}
          <p className={`text-xs text-center ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            These are estimates based on mathematical formulas. Actual 1RM may vary based on technique, fatigue, and training experience.
          </p>
        </div>
      </div>
    </div>
  );
}
