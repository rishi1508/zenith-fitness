import { Info, Star } from 'lucide-react';
import type { RatingsSummary } from '../../../gymRatings';
import { Card, IconButton } from '../../../ui';
import { CAPTION, SUB } from '../../../ui/styles';

/**
 * Session ratings at a glance: the 30-day average, how many members rated,
 * and each trainer's line. Anonymous by construction (api/rate.ts) — this
 * card never has a name to show, and says so.
 */
export function RatingsCard({ summary, trainerLabel, onInfo }: {
  summary: RatingsSummary;
  trainerLabel: (uid: string | null) => string;
  onInfo: () => void;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={CAPTION}>Session ratings · 30d</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-display text-3xl font-bold text-text">{summary.avg != null ? summary.avg.toFixed(1) : '—'}</span>
            <span className={SUB}>/ 5 · {summary.count} rating{summary.count === 1 ? '' : 's'}</span>
          </div>
        </div>
        <IconButton icon={Info} label="About session ratings" size="sm" onClick={onInfo} />
      </div>
      {summary.count === 0 ? (
        <p className={`${SUB} mt-2`}>Members rate a class from its page once it has happened. Ratings are anonymous.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {summary.byTrainer.slice(0, 6).map((t) => (
            <div key={t.trainerUid ?? 'none'} className="flex items-center gap-3">
              <span className="text-sm text-text flex-1 truncate">{trainerLabel(t.trainerUid)}</span>
              <div className="flex items-center gap-0.5" aria-label={`${t.avg} out of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={`w-3.5 h-3.5 ${n <= Math.round(t.avg) ? 'text-amber-400 fill-amber-400' : 'text-subtle'}`} strokeWidth={1.75} />
                ))}
              </div>
              <span className="text-sm font-semibold text-text w-8 text-right">{t.avg.toFixed(1)}</span>
              <span className={`${SUB} w-10 text-right`}>{t.count}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
