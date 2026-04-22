import { useState } from 'react';
import {
  ArrowLeft, Dumbbell, ChevronRight, Calculator, Trophy, Scale, Layers, Ruler,
} from 'lucide-react';
import { PlateCalculator, OneRMCalculator } from '../components';

interface ServicesViewProps {
  isDark: boolean;
  onBack: () => void;
  onOpenExerciseLibrary: () => void;
  onOpenCommonTemplates: () => void;
  onOpenBodyWeight: () => void;
  onOpenBodyMeasurements: () => void;
}

export function ServicesView({
  isDark, onBack, onOpenExerciseLibrary, onOpenCommonTemplates, onOpenBodyWeight, onOpenBodyMeasurements,
}: ServicesViewProps) {
  const [showPlateCalc, setShowPlateCalc] = useState(false);
  const [showOneRM, setShowOneRM] = useState(false);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  type Item = {
    label: string;
    hint: string;
    icon: React.ReactNode;
    color: string;
    bg: string;
    onClick: () => void;
  };
  const items: Item[] = [
    {
      label: 'Exercise Library',
      hint: 'Browse and edit all exercises',
      icon: <Dumbbell className="w-5 h-5" />,
      color: 'text-orange-400',
      bg: isDark ? 'bg-orange-500/15' : 'bg-orange-100',
      onClick: onOpenExerciseLibrary,
    },
    {
      label: 'Common Templates',
      hint: 'Shared workout templates from the community',
      icon: <Layers className="w-5 h-5" />,
      color: 'text-emerald-400',
      bg: isDark ? 'bg-emerald-500/15' : 'bg-emerald-100',
      onClick: onOpenCommonTemplates,
    },
    {
      label: 'Plate Calculator',
      hint: 'Calculate what plates to load',
      icon: <Calculator className="w-5 h-5" />,
      color: 'text-cyan-400',
      bg: isDark ? 'bg-cyan-500/15' : 'bg-cyan-100',
      onClick: () => setShowPlateCalc(true),
    },
    {
      label: '1RM Calculator',
      hint: 'Estimate your max from any rep range',
      icon: <Trophy className="w-5 h-5" />,
      color: 'text-yellow-400',
      bg: isDark ? 'bg-yellow-500/15' : 'bg-yellow-100',
      onClick: () => setShowOneRM(true),
    },
    {
      label: 'Body Weight',
      hint: 'Track your weight over time with a trend chart',
      icon: <Scale className="w-5 h-5" />,
      color: 'text-purple-400',
      bg: isDark ? 'bg-purple-500/15' : 'bg-purple-100',
      onClick: onOpenBodyWeight,
    },
    {
      label: 'Body Measurements',
      hint: 'Log circumferences for chest, arms, waist and more',
      icon: <Ruler className="w-5 h-5" />,
      color: 'text-blue-400',
      bg: isDark ? 'bg-blue-500/15' : 'bg-blue-100',
      onClick: onOpenBodyMeasurements,
    },
  ];

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Services</h1>
      </div>

      <p className={`text-sm ${subtle}`}>
        Tools and utilities to power your workouts.
      </p>

      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.label}
            onClick={item.onClick}
            className={`w-full rounded-xl border p-4 flex items-center justify-between transition-colors ${cardBg} ${cardBorder} ${isDark ? 'hover:border-orange-500/40' : 'hover:border-orange-400'}`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${item.bg} ${item.color}`}>
                {item.icon}
              </div>
              <div className="text-left">
                <div className="font-medium text-sm">{item.label}</div>
                <div className={`text-xs ${subtle}`}>{item.hint}</div>
              </div>
            </div>
            <ChevronRight className={`w-5 h-5 ${subtle}`} />
          </button>
        ))}
      </div>

      {showPlateCalc && (
        <PlateCalculator onClose={() => setShowPlateCalc(false)} isDark={isDark} />
      )}
      {showOneRM && (
        <OneRMCalculator onClose={() => setShowOneRM(false)} isDark={isDark} />
      )}
    </div>
  );
}
