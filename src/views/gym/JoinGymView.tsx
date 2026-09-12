import { ArrowLeft, Building2, Phone, Sparkles, UserRound } from 'lucide-react';
import type { GymViewProps } from './types';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { useMyProfile } from '../../profile/useMyProfile';
import { Card, H1, SUB, CAPTION } from '../../ui';

/**
 * What a member without a gym sees: how a gym on Zenith gets them in.
 * There is no code to type — the front desk adds people by mobile number
 * and that creates (or links) the Zenith account, so all this screen has
 * to do is say so and show the number the desk should use. Also the inline
 * fallback GymHomeView renders when the signed-in user has no gym yet.
 */
export function JoinGymView({ onBack, onNavigate }: GymViewProps) {
  const { user } = useAuth();
  const { profile } = useMyProfile();

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-2">
        <button aria-label="Back" onClick={onBack} className="w-10 h-10 -ml-2 shrink-0 flex items-center justify-center rounded-control text-muted hover:text-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className={H1}>Your gym on Zenith</h1>
      </div>

      <Card>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-control bg-accent-soft text-accent flex items-center justify-center shrink-0"><Building2 className="w-5 h-5" strokeWidth={1.75} /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">The front desk adds you</p>
            <p className={`${SUB} mt-1`}>Gyms on Zenith enrol members themselves. Give the desk the mobile number on your account and your membership, classes, check-ins and the gym's plans appear here.</p>
          </div>
        </div>
      </Card>

      <Card>
        <span className={CAPTION}>The number to give them</span>
        <div className="flex items-center gap-3 mt-2">
          <Phone className="w-5 h-5 text-accent shrink-0" strokeWidth={1.75} />
          <span className="text-lg font-semibold text-text tabular-nums">{profile?.phone ?? user?.phoneNumber ?? 'No number on this account yet'}</span>
        </div>
        {user?.email && (
          <div className="flex items-center gap-3 mt-2">
            <UserRound className="w-5 h-5 text-subtle shrink-0" strokeWidth={1.75} />
            <span className="text-sm text-muted truncate">{user.email}</span>
          </div>
        )}
        <p className={`${SUB} mt-3`}>Already a member and it is not showing? Ask the desk to check the number on your record matches this one.</p>
      </Card>

      {isAdmin(user?.uid) && (
        <button
          onClick={() => onNavigate('gym-create')}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-card border border-border bg-surface text-sm font-medium text-muted"
        >
          <Sparkles className="w-4 h-4" /> Create a gym
        </button>
      )}
    </div>
  );
}
