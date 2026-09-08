import { BicepsFlexed, ChevronsUp, CircleDot, Dumbbell, Footprints, Layers, PersonStanding, Shield, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MuscleGroup } from '../../types';

/**
 * Section order for the grouped library: the big compound groups first,
 * then the arms, then the accessory buckets — the order a training day is
 * usually written in, which also puts the largest sections at the top.
 */
export const MUSCLE_ORDER: readonly MuscleGroup[] =
  ['chest', 'back', 'legs', 'shoulders', 'biceps', 'triceps', 'core', 'full_body', 'other'];

/** One glyph per group so the sections read at a glance. */
export const MUSCLE_ICON: Record<MuscleGroup, LucideIcon> = {
  chest: Shield,
  back: Layers,
  legs: Footprints,
  shoulders: ChevronsUp,
  biceps: BicepsFlexed,
  triceps: Dumbbell,
  core: Target,
  full_body: PersonStanding,
  other: CircleDot,
};

/**
 * Leading-tile classes per group. Every colour comes from the `@theme`
 * tokens (docs/REVAMP_SPEC.md §1), so the accents follow the light/dark
 * swap instead of being frozen to the old dark-only palette. There are six
 * semantic tones and nine groups, so a few share a tone — the icon and the
 * section header carry the rest of the distinction.
 */
export const MUSCLE_TILE: Record<MuscleGroup, string> = {
  chest: 'bg-info/14 text-info',
  back: 'bg-ok/14 text-ok',
  legs: 'bg-accent-soft text-accent',
  shoulders: 'bg-warn/16 text-warn',
  biceps: 'bg-danger/14 text-danger',
  triceps: 'bg-danger/14 text-danger',
  core: 'bg-info/14 text-info',
  full_body: 'bg-ok/14 text-ok',
  other: 'bg-surface-2 text-muted',
};
