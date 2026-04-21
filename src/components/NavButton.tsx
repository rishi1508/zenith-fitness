import React from 'react';

interface NavButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  /** Unread/pending count to display as a badge on the icon. 0 hides it. */
  badge?: number;
}

export function NavButton({ icon, label, active, onClick, badge }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
        active ? 'text-orange-400' : 'text-zinc-500'
      }`}
    >
      <span className="relative w-6 h-6">
        {icon}
        {badge && badge > 0 ? (
          <span
            className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] leading-[16px] font-bold text-white bg-red-500 flex items-center justify-center"
            aria-label={`${badge} pending`}
          >
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </span>
      <span className="text-xs">{label}</span>
    </button>
  );
}
