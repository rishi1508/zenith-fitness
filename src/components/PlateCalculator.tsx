import { useState, useMemo } from 'react';
import { X, Calculator, RefreshCw } from 'lucide-react';

interface PlateCalculatorProps {
  onClose: () => void;
  initialWeight?: number;
  isDark: boolean;
}

// Standard plate weights in kg (both sides combined = plate × 2)
const STANDARD_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
const BARBELL_WEIGHT = 20; // Standard Olympic barbell

interface PlateResult {
  weight: number;
  count: number; // Per side
}

function calculatePlates(targetWeight: number, barbellWeight: number = BARBELL_WEIGHT): PlateResult[] {
  // Weight to load on the bar (excluding barbell)
  let remaining = targetWeight - barbellWeight;
  
  if (remaining <= 0) return [];
  
  // Weight per side
  const perSide = remaining / 2;
  let sideRemaining = perSide;
  
  const plates: PlateResult[] = [];
  
  for (const plateWeight of STANDARD_PLATES) {
    if (sideRemaining >= plateWeight) {
      const count = Math.floor(sideRemaining / plateWeight);
      plates.push({ weight: plateWeight, count });
      sideRemaining -= count * plateWeight;
    }
  }
  
  return plates;
}

export function PlateCalculator({ onClose, initialWeight = 60, isDark }: PlateCalculatorProps) {
  const [targetWeight, setTargetWeight] = useState(initialWeight);
  const [barbellWeight, setBarbellWeight] = useState(BARBELL_WEIGHT);
  const [customBarbell, setCustomBarbell] = useState(false);

  const plates = useMemo(() => 
    calculatePlates(targetWeight, barbellWeight), 
    [targetWeight, barbellWeight]
  );

  const actualTotal = useMemo(() => {
    const platesTotal = plates.reduce((sum, p) => sum + (p.weight * p.count * 2), 0);
    return barbellWeight + platesTotal;
  }, [plates, barbellWeight]);

  const quickWeights = [40, 60, 80, 100, 120, 140];

  // Plate colors for visual representation
  const getPlateColor = (weight: number) => {
    switch (weight) {
      case 25: return 'bg-red-500';
      case 20: return 'bg-blue-500';
      case 15: return 'bg-yellow-500';
      case 10: return 'bg-green-500';
      case 5: return 'bg-white border-2 border-zinc-400';
      case 2.5: return 'bg-red-300';
      case 1.25: return 'bg-zinc-400';
      default: return 'bg-zinc-500';
    }
  };

  const getPlateWidth = (weight: number) => {
    // Proportional width based on plate size
    if (weight >= 20) return 'w-4';
    if (weight >= 10) return 'w-3';
    return 'w-2';
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className={`w-full max-w-md rounded-2xl overflow-hidden ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}>
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-orange-400" />
            <h2 className="text-lg font-bold">Plate Calculator</h2>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Target Weight Input */}
          <div>
            <label className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Target Weight (kg)</label>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setTargetWeight(Math.max(barbellWeight, targetWeight - 2.5))}
                className={`px-4 py-2 rounded-lg font-bold text-lg ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}
              >
                −
              </button>
              <input
                type="number"
                value={targetWeight}
                onChange={(e) => setTargetWeight(Math.max(barbellWeight, parseFloat(e.target.value) || barbellWeight))}
                className={`flex-1 text-center text-2xl font-bold py-2 rounded-lg border ${
                  isDark ? 'bg-[#252525] border-[#3e3e3e]' : 'bg-gray-50 border-gray-200'
                } focus:outline-none focus:border-orange-500`}
              />
              <button
                onClick={() => setTargetWeight(targetWeight + 2.5)}
                className={`px-4 py-2 rounded-lg font-bold text-lg ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}
              >
                +
              </button>
            </div>
          </div>

          {/* Quick Weights */}
          <div className="flex flex-wrap gap-2">
            {quickWeights.map(w => (
              <button
                key={w}
                onClick={() => setTargetWeight(w)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  targetWeight === w
                    ? 'bg-orange-500 text-white'
                    : isDark ? 'bg-[#252525] text-zinc-300' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {w}kg
              </button>
            ))}
          </div>

          {/* Barbell Weight Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}>
            <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>Barbell</span>
            <div className="flex items-center gap-2">
              {customBarbell ? (
                <input
                  type="number"
                  value={barbellWeight}
                  onChange={(e) => setBarbellWeight(parseFloat(e.target.value) || 20)}
                  className={`w-16 text-center text-sm py-1 rounded border ${
                    isDark ? 'bg-[#1a1a1a] border-[#3e3e3e]' : 'bg-white border-gray-300'
                  }`}
                />
              ) : (
                <span className="font-medium">{barbellWeight}kg</span>
              )}
              <button
                onClick={() => {
                  if (customBarbell) {
                    setBarbellWeight(20);
                  }
                  setCustomBarbell(!customBarbell);
                }}
                className={`p-1.5 rounded ${isDark ? 'hover:bg-[#1a1a1a]' : 'hover:bg-white'}`}
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Visual Barbell Representation */}
          <div className={`p-4 rounded-xl ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}>
            <div className="flex items-center justify-center gap-0.5 h-16">
              {/* Left plates (reversed order for visual) */}
              <div className="flex items-center gap-0.5">
                {plates.slice().reverse().map((plate, i) => (
                  Array.from({ length: plate.count }).map((_, j) => (
                    <div
                      key={`left-${i}-${j}`}
                      className={`h-${plate.weight >= 20 ? 14 : plate.weight >= 10 ? 12 : 8} ${getPlateWidth(plate.weight)} ${getPlateColor(plate.weight)} rounded-sm`}
                      style={{ height: plate.weight >= 20 ? '3.5rem' : plate.weight >= 10 ? '3rem' : '2rem' }}
                      title={`${plate.weight}kg`}
                    />
                  ))
                ))}
              </div>

              {/* Barbell */}
              <div className={`h-3 w-24 rounded-full ${isDark ? 'bg-zinc-600' : 'bg-zinc-400'}`} />

              {/* Right plates */}
              <div className="flex items-center gap-0.5">
                {plates.map((plate, i) => (
                  Array.from({ length: plate.count }).map((_, j) => (
                    <div
                      key={`right-${i}-${j}`}
                      className={`h-${plate.weight >= 20 ? 14 : plate.weight >= 10 ? 12 : 8} ${getPlateWidth(plate.weight)} ${getPlateColor(plate.weight)} rounded-sm`}
                      style={{ height: plate.weight >= 20 ? '3.5rem' : plate.weight >= 10 ? '3rem' : '2rem' }}
                      title={`${plate.weight}kg`}
                    />
                  ))
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {plates.map((plate, i) => (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <div className={`w-3 h-3 rounded-sm ${getPlateColor(plate.weight)}`} />
                  <span className={isDark ? 'text-zinc-400' : 'text-gray-600'}>
                    {plate.weight}kg × {plate.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Plate List */}
          <div className={`rounded-xl p-4 ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}>
            <div className={`text-sm font-medium mb-3 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
              Load per side:
            </div>
            {plates.length === 0 ? (
              <div className={`text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                Just the bar ({barbellWeight}kg)
              </div>
            ) : (
              <div className="space-y-2">
                {plates.map((plate, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded ${getPlateColor(plate.weight)}`} />
                      <span className="font-medium">{plate.weight}kg</span>
                    </div>
                    <span className={isDark ? 'text-zinc-400' : 'text-gray-600'}>
                      × {plate.count} {plate.count === 1 ? 'plate' : 'plates'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            
            {/* Total check */}
            <div className={`mt-3 pt-3 border-t flex justify-between ${isDark ? 'border-[#3e3e3e]' : 'border-gray-300'}`}>
              <span className={isDark ? 'text-zinc-400' : 'text-gray-600'}>Actual total:</span>
              <span className={`font-bold ${actualTotal === targetWeight ? 'text-green-400' : 'text-yellow-400'}`}>
                {actualTotal}kg
                {actualTotal !== targetWeight && (
                  <span className="text-xs ml-1">
                    ({actualTotal > targetWeight ? '+' : ''}{actualTotal - targetWeight}kg)
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
