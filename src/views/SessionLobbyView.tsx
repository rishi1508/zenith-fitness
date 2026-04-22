import { useState, useEffect } from 'react';
import {
  ArrowLeft, UserPlus, Play, Loader2, Dumbbell, Clock,
  Check, X, Users, Crown,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components';
import type { WorkoutSession, BuddyRelationship } from '../types';
import * as sessionService from '../workoutSessionService';
import * as buddyService from '../buddyService';

interface SessionLobbyViewProps {
  sessionId: string;
  isDark: boolean;
  onBack: () => void;
  onSessionStart: (session: WorkoutSession) => void;
}

export function SessionLobbyView({ sessionId, isDark, onBack, onSessionStart }: SessionLobbyViewProps) {
  const { user } = useAuth();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [buddies, setBuddies] = useState<BuddyRelationship[]>([]);
  const [buddyProfiles, setBuddyProfiles] = useState<Map<string, { name: string; photoURL: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtleText = isDark ? 'text-zinc-400' : 'text-gray-500';

  // Listen to session in real-time
  useEffect(() => {
    const unsub = sessionService.listenToSession(sessionId, (s) => {
      setSession(s);
      setLoading(false);
      // If session became active, notify parent
      if (s && s.status === 'active') {
        onSessionStart(s);
      }
    });
    return unsub;
  }, [sessionId, onSessionStart]);

  // Load buddy list for inviting
  useEffect(() => {
    const loadBuddies = async () => {
      const b = await buddyService.getBuddies();
      setBuddies(b);
      // Fetch profiles
      for (const buddy of b) {
        const buddyUid = buddy.users.find((u) => u !== user?.uid);
        if (buddyUid) {
          const profile = await buddyService.getUserProfile(buddyUid);
          if (profile) {
            setBuddyProfiles((prev) => new Map(prev).set(buddyUid, {
              name: profile.displayName,
              photoURL: profile.photoURL || null,
            }));
          }
        }
      }
    };
    loadBuddies();
  }, [user]);

  const handleInvite = async (buddyUid: string, buddyName: string, buddyPhotoURL: string | null) => {
    setInviting(buddyUid);
    try {
      await sessionService.inviteToSession(sessionId, buddyUid, buddyName, buddyPhotoURL);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setInviting(null);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await sessionService.startSession(sessionId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to start');
      setStarting(false);
    }
  };

  const handleJoin = async () => {
    try {
      await sessionService.joinSession(sessionId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to join');
    }
  };

  const handleDecline = async () => {
    await sessionService.declineSession(sessionId);
    onBack();
  };

  if (loading || !session) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
      </div>
    );
  }

  const isHost = session.hostUid === user?.uid;
  const myStatus = user ? session.participants[user.uid]?.status : null;
  const participants = Object.values(session.participants);
  const joinedCount = participants.filter((p) => p.status === 'joined' || p.status === 'active').length;
  const canStart = isHost && joinedCount >= 2;

  // Buddies not yet in the session (available to invite)
  const invitableBuddies = buddies.filter((b) => {
    const buddyUid = b.users.find((u) => u !== user?.uid);
    return buddyUid && !session.participants[buddyUid];
  });

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold">Workout Session</h1>
          <p className={`text-xs ${subtleText}`}>Waiting for buddies...</p>
        </div>
      </div>

      {/* Workout Info */}
      <div className={`rounded-xl border p-4 ${cardBg} ${cardBorder}`}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
            <Dumbbell className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="font-bold">{session.workoutName}</div>
            <div className={`text-xs ${subtleText}`}>
              {session.templateExercises.length} exercises &middot; {participants.length}/3 participants
            </div>
          </div>
        </div>
      </div>

      {/* Participants */}
      <div>
        <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtleText}`}>
          Participants
        </h3>
        <div className="space-y-2">
          {participants.map((p) => (
            <div
              key={p.uid}
              className={`flex items-center justify-between p-3 rounded-xl border ${cardBg} ${cardBorder}`}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Avatar
                    name={p.name}
                    photoURL={p.photoURL}
                    presence={p.status === 'active' ? 'in-workout' : p.status === 'joined' ? 'online' : undefined}
                  />
                  {p.uid === session.hostUid && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 flex items-center justify-center">
                      <Crown className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </div>
                <div>
                  <div className="font-medium text-sm">
                    {p.name} {p.uid === user?.uid && <span className={`${subtleText}`}>(You)</span>}
                  </div>
                  <div className={`text-xs ${
                    p.status === 'joined' ? 'text-emerald-400' :
                    p.status === 'invited' ? 'text-yellow-400' :
                    p.status === 'declined' ? 'text-red-400' :
                    subtleText
                  }`}>
                    {p.status === 'joined' ? 'Ready' :
                     p.status === 'invited' ? 'Invited...' :
                     p.status === 'declined' ? 'Declined' :
                     p.status}
                  </div>
                </div>
              </div>
              {p.status === 'joined' && (
                <Check className="w-4 h-4 text-emerald-400" />
              )}
              {p.status === 'invited' && (
                <Clock className="w-4 h-4 text-yellow-400" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Invite More Buddies (host only, if < 3 participants) */}
      {isHost && participants.length < 3 && invitableBuddies.length > 0 && (
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${subtleText}`}>
            Invite Buddies
          </h3>
          <div className="space-y-2">
            {invitableBuddies.map((buddy) => {
              const buddyUid = buddy.users.find((u) => u !== user?.uid)!;
              const profile = buddyProfiles.get(buddyUid);
              const buddyName = profile?.name || buddy.userNames[buddyUid] || 'Buddy';
              return (
                <div
                  key={buddyUid}
                  className={`flex items-center justify-between p-3 rounded-xl border ${cardBg} ${cardBorder}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={buddyName} photoURL={profile?.photoURL || null} />
                    <div className="font-medium text-sm">{buddyName}</div>
                  </div>
                  <button
                    onClick={() => handleInvite(buddyUid, buddyName, profile?.photoURL || null)}
                    disabled={inviting === buddyUid}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {inviting === buddyUid ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    Invite
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Accept/Decline (for invited non-host) */}
      {!isHost && myStatus === 'invited' && (
        <div className="flex gap-3">
          <button
            onClick={handleDecline}
            className={`flex-1 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
              isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            <X className="w-4 h-4" /> Decline
          </button>
          <button
            onClick={handleJoin}
            className="flex-1 py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" /> Join Session
          </button>
        </div>
      )}

      {/* Waiting message for non-host who joined */}
      {!isHost && myStatus === 'joined' && (
        <div className={`text-center py-4 ${subtleText}`}>
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Waiting for host to start...</p>
        </div>
      )}

      {/* Start Button (host only) */}
      {isHost && (
        <button
          onClick={handleStart}
          disabled={!canStart || starting}
          className="w-full py-4 rounded-xl font-bold text-sm bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {starting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Play className="w-5 h-5" />
          )}
          {canStart ? 'Start Workout!' : `Waiting for buddies (${joinedCount}/2 min)`}
        </button>
      )}
    </div>
  );
}
