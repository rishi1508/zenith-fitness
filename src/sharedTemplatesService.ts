import {
  doc, setDoc, getDoc, getDocs, collection, query, orderBy, limit,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import type { WeeklyPlan, WorkoutTemplate } from './types';

export interface SharedTemplate {
  id: string;
  name: string;
  type: 'weekly-plan' | 'workout';
  creatorUid: string;
  creatorName: string;
  createdAt: string;
  useCount: number;
  /** Payload — whatever the user needs to recreate the template locally. */
  payload: WeeklyPlan | WorkoutTemplate;
}

/** Publish one of the user's weekly plans or workout templates to the
 *  shared library. Any authenticated user can read afterwards. */
export async function publishSharedTemplate(
  name: string,
  type: 'weekly-plan' | 'workout',
  payload: WeeklyPlan | WorkoutTemplate,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const id = crypto.randomUUID();
  const tpl: SharedTemplate = {
    id,
    name: name.trim(),
    type,
    creatorUid: user.uid,
    creatorName: user.displayName || 'Anonymous',
    createdAt: new Date().toISOString(),
    useCount: 0,
    payload,
  };
  await setDoc(doc(db, 'sharedTemplates', id), tpl);
  return id;
}

/** List shared templates (newest first). */
export async function listSharedTemplates(max = 100): Promise<SharedTemplate[]> {
  try {
    const q = query(
      collection(db, 'sharedTemplates'),
      orderBy('createdAt', 'desc'),
      limit(max),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as SharedTemplate);
  } catch (err) {
    console.error('[SharedTemplates] list failed:', err);
    return [];
  }
}

/** Fetch one shared template by id. */
export async function getSharedTemplate(id: string): Promise<SharedTemplate | null> {
  const snap = await getDoc(doc(db, 'sharedTemplates', id));
  return snap.exists() ? (snap.data() as SharedTemplate) : null;
}

/** Increment useCount — best-effort, ignore failure. */
export async function bumpUseCount(id: string): Promise<void> {
  try {
    const snap = await getDoc(doc(db, 'sharedTemplates', id));
    if (!snap.exists()) return;
    const current = snap.data() as SharedTemplate;
    await setDoc(doc(db, 'sharedTemplates', id), {
      ...current,
      useCount: (current.useCount || 0) + 1,
    });
  } catch (err) {
    console.warn('[SharedTemplates] bumpUseCount failed:', err);
  }
}
