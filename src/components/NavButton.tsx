import React from 'react';

interface NavButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function NavButton({ icon, label, active, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
        active ? 'text-orange-400' : 'text-zinc-500'
      }`}
    >
      <span className="w-6 h-6">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}
