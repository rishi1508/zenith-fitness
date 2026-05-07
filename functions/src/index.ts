import * as functions from "firebase-functions";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import * as crypto from "crypto";

admin.initializeApp();
const db = admin.firestore();

// SMTP transporter — reads from process.env (set via functions/.env or CI secrets)
function getTransporter() {
  const smtpEmail = process.env.SMTP_EMAIL;
  const smtpPassword = process.env.SMTP_PASSWORD;

  if (!smtpEmail || !smtpPassword) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "SMTP credentials not configured. Set SMTP_EMAIL and SMTP_PASSWORD."
    );
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: smtpEmail,
      pass: smtpPassword,
    },
  });
}

/**
 * Generate and send a 6-digit OTP to the given email address.
 * Callable from the client via httpsCallable.
 */
export const sendOTP = functions.https.onCall(async (data) => {
  const email: string | undefined = data?.email;
  if (!email || !email.includes("@")) {
    throw new functions.https.HttpsError("invalid-argument", "Valid email required.");
  }

  const normalizedEmail = email.toLowerCase().trim();
  const docRef = db.collection("otpCodes").doc(normalizedEmail);

  // Rate limit: wait at least 1 minute between codes
  const existing = await docRef.get();
  if (existing.exists) {
    const d = existing.data()!;
    const oneMinuteAgo = Date.now() - 60 * 1000;
    if (d.createdAt && d.createdAt.toMillis() > oneMinuteAgo) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "Please wait at least 1 minute before requesting a new code."
      );
    }
  }

  // Generate 6-digit OTP
  const code = crypto.randomInt(100000, 999999).toString();
  const hashedCode = crypto.createHash("sha256").update(code).digest("hex");

  // Store in Firestore (expires in 10 minutes)
  await docRef.set({
    hashedCode,
    email: normalizedEmail,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
  });

  // Send email
  const smtpEmail = process.env.SMTP_EMAIL!;
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Zenith Fitness" <${smtpEmail}>`,
    to: normalizedEmail,
    subject: "Your Zenith Fitness Login Code",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #f97316, #dc2626); line-height: 48px; font-size: 24px; color: white;">&#128293;</div>
          <h2 style="margin: 12px 0 4px; color: #1a1a1a;">Zenith Fitness</h2>
        </div>
        <p style="color: #555; text-align: center;">Your verification code is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 10px; padding: 20px; background: #f9fafb; border-radius: 16px; text-align: center; color: #f97316; margin: 16px 0; border: 1px solid #e5e7eb;">
          ${code}
        </div>
        <p style="color: #999; font-size: 13px; text-align: center; margin-top: 20px;">
          This code expires in 10 minutes.<br/>
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  return { success: true };
});

/**
 * Verify the OTP code and return a custom auth token.
 * Creates a new Firebase Auth user if one doesn't exist for this email.
 */
export const verifyOTP = functions.https.onCall(async (data) => {
  const email: string | undefined = data?.email;
  const code: string | undefined = data?.code;

  if (!email || !code) {
    throw new functions.https.HttpsError("invalid-argument", "Email and code are required.");
  }

  const normalizedEmail = email.toLowerCase().trim();
  const docRef = db.collection("otpCodes").doc(normalizedEmail);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "No verification code found. Please request a new one."
    );
  }

  const otpData = doc.data()!;

  // Check expiry
  if (Date.now() > otpData.expiresAt) {
    await docRef.delete();
    throw new functions.https.HttpsError(
      "deadline-exceeded",
      "Code has expired. Please request a new one."
    );
  }

  // Check max attempts
  if (otpData.attempts >= 5) {
    await docRef.delete();
    throw new functions.https.HttpsError(
      "resource-exhausted",
      "Too many attempts. Please request a new code."
    );
  }

  // Verify code
  const hashedInput = crypto.createHash("sha256").update(code).digest("hex");
  if (hashedInput !== otpData.hashedCode) {
    await docRef.update({
      attempts: admin.firestore.FieldValue.increment(1),
    });
    const remaining = 5 - (otpData.attempts + 1);
    throw new functions.https.HttpsError(
      "permission-denied",
      `Invalid code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
    );
  }

  // Code is valid — delete it
  await docRef.delete();

  // Find or create Firebase Auth user
  let isNewUser = false;
  let uid: string;

  try {
    const userRecord = await admin.auth().getUserByEmail(normalizedEmail);
    uid = userRecord.uid;
  } catch (err: unknown) {
    const firebaseErr = err as { code?: string };
    if (firebaseErr.code === "auth/user-not-found") {
      const newUser = await admin.auth().createUser({
        email: normalizedEmail,
      });
      uid = newUser.uid;
      isNewUser = true;
    } else {
      throw new functions.https.HttpsError("internal", "Failed to look up user.");
    }
  }

  // Generate custom auth token
  const token = await admin.auth().createCustomToken(uid);

  return { token, isNewUser };
});

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
  "workoutSessions/{sessionId}",
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
        const exercises = allExercises
          .map((ex) => {
            const sets = ((ex.sets as Array<Record<string, unknown>>) || []).filter((s) => {
              const completed = !!s.completed;
              const weight = Number(s.weight) || 0;
              const reps = Number(s.reps) || 0;
              return completed && weight > 0 && reps > 0;
            });
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

          const completedAt = session.completedAt || new Date().toISOString();
          const startedAt = session.startedAt;
          const duration = participant.duration ?? (
            startedAt ? Math.max(0, Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 60000)) : undefined
          );

          const workout: Record<string, unknown> = {
            id: `session_${sessionId}_${uid}`,
            date: completedAt,
            name: session.workoutName || "Buddy Session",
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
