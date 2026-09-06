import { ArrowLeft } from 'lucide-react';
import type { GymViewProps } from './types';

/**
 * Shared placeholder body for every not-yet-built gym screen. Renders
 * the view name, a Back button, and whichever nav params it received so
 * the UI agent replacing this file can see what App.tsx passes in. Not
 * exported from views/index.ts — each named placeholder in this
 * directory wraps this with its own title/view-name so it stays a
 * single, trivially-replaceable file per screen.
 */
export function GymPlaceholderBody({
  title, viewName, isDark, onBack, gymId, classId, memberUid,
}: GymViewProps & { title: string; viewName: string }) {
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">{title}</h1>
      </div>
      <div className={`rounded-xl border p-4 text-sm space-y-1 ${cardBg} ${cardBorder} ${subtle}`}>
        <p>Placeholder for <code>{viewName}</code> — not built yet.</p>
        {gymId && <p>gymId: <code>{gymId}</code></p>}
        {classId && <p>classId: <code>{classId}</code></p>}
        {memberUid && <p>memberUid: <code>{memberUid}</code></p>}
      </div>
    </div>
  );
}
