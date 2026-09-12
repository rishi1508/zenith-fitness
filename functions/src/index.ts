import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {onMessagePublished} from "firebase-functions/v2/pubsub";
import {logger} from "firebase-functions/v2";
import * as admin from "firebase-admin";
import {GoogleAuth} from "google-auth-library";

admin.initializeApp();
const db = admin.firestore();

// Bounds for what a session doc may turn into on a participant's history.
const MAX_EXERCISES = 40;
const MAX_SETS = 30;
const MAX_NAME = 60;
const MAX_DURATION_MIN = 24 * 60;
const isoOrNow = (v: unknown): string =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : new Date().toISOString();

/**
 * When the host ends a buddy session (status flips to 'completed'),
 * save EVERY participant's workout to their cloud history server-side.
 *
 * Why: the client-side flow only persists when the participant's app
 * is open / its session listener is active. Backgrounded or closed
 * apps would silently lose the workout on host-end. This trigger is
 * the belt-and-suspenders fix — workouts land in
 * users/{uid}/data/workouts even if the participant never reopens the
 * app.
 *
 * Idempotent: each participant's workouts array is checked for an
 * existing entry with the same sessionId before appending. The
 * participant's own client save (if it ran) wins by going first; this
 * trigger's transaction sees that entry and skips. If the trigger
 * goes first, the client's later save will see the duplicate and
 * skip. Either way, exactly one workout per session per participant.
 */
export const saveWorkoutOnSessionComplete = onDocumentUpdated(
  {document: "workoutSessions/{sessionId}", maxInstances: 3},
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only fire on the transition INTO 'completed'. We don't auto-save
    // for 'cancelled' — host explicitly aborted, the client discards.
    if (before.status === after.status) return;
    if (after.status !== "completed") return;

    const sessionId = event.params.sessionId;
    const session = after as Record<string, unknown> & {
      participants?: Record<string, Record<string, unknown>>;
      hostUid?: string;
      workoutName?: string;
      workoutType?: string;
      startedAt?: string;
      completedAt?: string;
    };
    const participants = session.participants || {};

    for (const [uid, raw] of Object.entries(participants)) {
      const participant = raw as Record<string, unknown> & { status?: string; duration?: number };
      // Skip people who never actually joined the workout.
      if (participant?.status === "declined" || participant?.status === "invited") continue;

      try {
        const progressRef = db.doc(`workoutSessions/${sessionId}/progress/${uid}`);
        const progressSnap = await progressRef.get();
        if (!progressSnap.exists) continue;
        const progressData = progressSnap.data() as { exercises?: Array<Record<string, unknown>> } | undefined;
        const allExercises = progressData?.exercises || [];

        // Drop exercises with no logged sets — saving a fully-empty
        // workout would clutter history without conveying anything.
        // The progress doc is client-written, so sizes are clamped too:
        // a workout has at most MAX_EXERCISES exercises of MAX_SETS sets.
        const exercises = allExercises
          .slice(0, MAX_EXERCISES)
          .map((ex) => {
            const sets = ((ex.sets as Array<Record<string, unknown>>) || []).filter((s) => {
              const completed = !!s.completed;
              const weight = Number(s.weight) || 0;
              const reps = Number(s.reps) || 0;
              return completed && weight > 0 && reps > 0;
            }).slice(0, MAX_SETS);
            return { ...ex, sets };
          })
          .filter((ex) => Array.isArray(ex.sets) && (ex.sets as unknown[]).length > 0);

        if (exercises.length === 0) {
          console.log(`[saveWorkoutOnSessionComplete] ${uid} has no logged sets, skipping`);
          continue;
        }

        const workoutsRef = db.doc(`users/${uid}/data/workouts`);
        await db.runTransaction(async (tx) => {
          const wSnap = await tx.get(workoutsRef);
          const existing = (wSnap.data()?.value || []) as Array<Record<string, unknown>>;
          if (existing.some((w) => w?.sessionId === sessionId)) {
            console.log(`[saveWorkoutOnSessionComplete] ${uid} already has session ${sessionId}, skipping`);
            return;
          }

          const completedAt = isoOrNow(session.completedAt);
          const startedAt = typeof session.startedAt === "string" && Number.isFinite(Date.parse(session.startedAt)) ? session.startedAt : undefined;
          const rawDuration = participant.duration ?? (
            startedAt ? Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 60000) : undefined
          );
          const duration = typeof rawDuration === "number" && Number.isFinite(rawDuration)
            ? Math.min(MAX_DURATION_MIN, Math.max(0, Math.floor(rawDuration))) : undefined;

          const workout: Record<string, unknown> = {
            id: `session_${sessionId}_${uid}`,
            date: completedAt,
            name: (typeof session.workoutName === "string" && session.workoutName.trim() ? session.workoutName.trim() : "Buddy Session").slice(0, MAX_NAME),
            type: session.workoutType || "custom",
            exercises,
            completed: true,
            completedAt,
            sessionId,
          };
          if (startedAt) workout.startedAt = startedAt;
          if (typeof duration === "number") workout.duration = duration;

          existing.unshift(workout);
          tx.set(
            workoutsRef,
            {value: existing, updatedAt: Date.now()},
            {merge: true},
          );
        });
        console.log(`[saveWorkoutOnSessionComplete] saved workout for ${uid} from session ${sessionId}`);
      } catch (err) {
        console.error(`[saveWorkoutOnSessionComplete] failed for ${uid}:`, err);
      }
    }
  },
);

/**
 * Billing kill switch. The Cloud Billing budget "Zenith Fitness monthly cap"
 * publishes its current spend to the `billing-alerts` topic several times a
 * day. When spend reaches the budget amount this detaches the billing
 * account from the project, which drops every service back to the free
 * (Spark) limits instead of billing further. Re-attaching is a manual step
 * in the Cloud console. A message with attribute dryRun="true" only checks
 * that the function holds the permissions it needs and logs the result.
 */
const BUDGET_NAME = "Zenith Fitness monthly cap";

interface BudgetNotification {
  budgetDisplayName?: string;
  costAmount?: number;
  budgetAmount?: number;
  currencyCode?: string;
  costIntervalStart?: string;
}

export const capBilling = onMessagePublished(
  {
    topic: "billing-alerts",
    maxInstances: 1,
    region: "us-central1",
    // Dedicated identity: the only principal in the project allowed to detach billing.
    serviceAccount: "billing-cap@zenith-fitness-18e2a.iam.gserviceaccount.com",
  },
  async (event) => {
    const msg = (event.data.message.json ?? {}) as BudgetNotification;
    const dryRun = event.data.message.attributes?.dryRun === "true";
    const projectId = process.env.GCLOUD_PROJECT ?? "zenith-fitness-18e2a";
    // Only the project's own budget may pull the switch. Anything else on
    // the topic (another budget, a stray publish) is logged and ignored.
    if (msg.budgetDisplayName && msg.budgetDisplayName !== BUDGET_NAME) {
      logger.warn("ignoring notification from another budget", {budget: msg.budgetDisplayName});
      return;
    }
    const cost = Number(msg.costAmount ?? 0);
    const budget = Number(msg.budgetAmount ?? 0);
    logger.info("budget notification", {cost, budget, currency: msg.currencyCode, dryRun});

    const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});
    const client = await auth.getClient();
    const infoUrl = `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`;
    const info = await client.request<{billingEnabled?: boolean; billingAccountName?: string}>({url: infoUrl});
    const account = info.data.billingAccountName ?? "";

    if (dryRun) {
      const projPerm = await client.request<{permissions?: string[]}>({
        url: `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:testIamPermissions`,
        method: "POST", data: {permissions: ["resourcemanager.projects.deleteBillingAssignment"]},
      });
      const acctPerm = account ? await client.request<{permissions?: string[]}>({
        url: `https://cloudbilling.googleapis.com/v1/${account}:testIamPermissions`,
        method: "POST", data: {permissions: ["billing.resourceAssociations.delete"]},
      }) : {data: {permissions: []}};
      logger.info("DRY RUN — permission check", {
        billingEnabled: info.data.billingEnabled, account,
        canDetachFromProject: (projPerm.data.permissions ?? []).length === 1,
        canDetachFromAccount: (acctPerm.data.permissions ?? []).length === 1,
        wouldDisable: budget > 0 && cost >= budget,
      });
      return;
    }

    if (!(budget > 0) || cost < budget) return;
    if (!info.data.billingEnabled) {
      logger.warn("over budget but billing is already disabled", {cost, budget});
      return;
    }
    await client.request({url: infoUrl, method: "PUT", data: {billingAccountName: ""}});
    logger.error("BILLING DISABLED: spend reached the monthly cap; project is back on free limits", {cost, budget, account});
  }
);
