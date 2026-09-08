import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import type { SavedMeal } from '../../types';

/** Strips the fields that belong to a specific day before sharing. */
function publishPayload(meal: SavedMeal): Record<string, unknown> {
  return {
    id: meal.id, name: meal.name, items: meal.items, kcal: meal.kcal,
    createdBy: meal.createdBy, createdByName: meal.createdByName ?? null, createdAt: meal.createdAt,
  };
}

/** Publish (or re-publish) a meal to the shared library (`sharedMeals`). */
export async function publishMeal(meal: SavedMeal): Promise<void> {
  await setDoc(doc(db, 'sharedMeals', meal.id), publishPayload(meal), { merge: true });
}
