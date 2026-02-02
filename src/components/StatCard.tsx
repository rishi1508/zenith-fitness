import React from 'react';

interface StatCardProps {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  suffix?: string;
  color: string;
}

const colorClasses: Record<string, string> = {
  orange: 'from-orange-500/20 to-orange-500/5 border-orange-500/20',
  emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20',
  yellow: 'from-yellow-500/20 to-yellow-500/5 border-yellow-500/20',
  indigo: 'from-indigo-500/20 to-indigo-500/5 border-indigo-500/20',
};

export function StatCard({ icon, value, label, suffix, color }: StatCardProps) {
  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} border rounded-xl p-4`}>
      <div className="w-8 h-8 mb-2">{icon}</div>
      <div className="text-2xl font-bold">
        {value}{suffix && <span className="text-sm text-zinc-500">{suffix}</span>}
      </div>
      <div className="text-sm text-zinc-400">{label}</div>
    </div>
  );
}
