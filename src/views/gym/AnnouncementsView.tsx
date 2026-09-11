import { ArrowLeft } from 'lucide-react';
import type { GymViewProps } from './types';
import { AnnouncementComposer, AnnouncementsPanel } from './AnnouncementsPanel';

/** The pushed Announcements screen, reached from Manage. Composer and list
 *  come from AnnouncementsPanel, the same pair the Feed tab renders — one
 *  implementation, two ways in. */
export function AnnouncementsView({ onBack, onOpenProfile }: GymViewProps) {
  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button aria-label="Back" onClick={onBack} className="p-2 rounded-lg transition-colors hover:bg-surface-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Announcements</h1>
      </div>

      <AnnouncementComposer />
      <AnnouncementsPanel onOpenProfile={onOpenProfile} />
    </div>
  );
}
