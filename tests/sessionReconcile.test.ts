import { describe, it, expect } from 'vitest';
import { reconcileWorkoutWithTemplate, templateFromWorkout, templatesEqual } from '../src/sessionTemplateReconcile';
import type { TemplateExercise, Workout } from '../src/types';

const tpl = (id: string, sets = 3): TemplateExercise => ({ exerciseId: id, exerciseName: id.toUpperCase(), defaultSets: sets, defaultReps: 10 });
const workout = (ids: string[], logged: string[] = []): Workout => ({
  id: 'w', date: '2026-09-12', name: 'Push', type: 'custom', completed: false,
  exercises: ids.map((id) => ({
    id: `we_${id}`, exerciseId: id, exerciseName: id.toUpperCase(),
    sets: [{ id: `s_${id}`, weight: logged.includes(id) ? 60 : 0, reps: logged.includes(id) ? 8 : 0, completed: logged.includes(id) }],
  })),
} as Workout);

describe('reconcileWorkoutWithTemplate', () => {
  it('inserts an added exercise at the position it holds in the shared list', () => {
    const prev = [tpl('a'), tpl('c')];
    const next = [tpl('a'), tpl('b'), tpl('c')];
    const out = reconcileWorkoutWithTemplate(workout(['a', 'c']), next, prev);
    expect(out?.exercises.map((e) => e.exerciseId)).toEqual(['a', 'b', 'c']);
    expect(out?.exercises[1].sets).toHaveLength(3);
  });

  it('removes an exercise everybody else removed, even with logged sets', () => {
    const prev = [tpl('a'), tpl('b')];
    const next = [tpl('a')];
    const out = reconcileWorkoutWithTemplate(workout(['a', 'b'], ['b']), next, prev);
    expect(out?.exercises.map((e) => e.exerciseId)).toEqual(['a']);
  });

  it('keeps this phone\'s own extra exercises after the shared ones', () => {
    const prev = [tpl('a')];
    const next = [tpl('a'), tpl('b')];
    const out = reconcileWorkoutWithTemplate(workout(['mine', 'a']), next, prev);
    expect(out?.exercises.map((e) => e.exerciseId)).toEqual(['a', 'b', 'mine']);
  });

  it('follows a reorder without touching sets', () => {
    const prev = [tpl('a'), tpl('b')];
    const next = [tpl('b'), tpl('a')];
    const out = reconcileWorkoutWithTemplate(workout(['a', 'b'], ['a']), next, prev);
    expect(out?.exercises.map((e) => e.exerciseId)).toEqual(['b', 'a']);
    expect(out?.exercises[1].sets[0].weight).toBe(60);
  });

  it('returns null when nothing observable changed', () => {
    const t = [tpl('a'), tpl('b')];
    expect(reconcileWorkoutWithTemplate(workout(['a', 'b']), t, t)).toBeNull();
  });

  it('round-trips through templateFromWorkout so an applied change does not echo', () => {
    const next = [tpl('a', 1), tpl('b', 1)];
    const out = reconcileWorkoutWithTemplate(workout(['a']), next, [tpl('a', 1)]);
    expect(out).not.toBeNull();
    expect(templatesEqual(templateFromWorkout(out as Workout), next)).toBe(true);
  });
});
