import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import * as crypto from "crypto";

admin.initializeApp();
const db = admin.firestore();

// SMTP transporter — configure via:
//   firebase functions:config:set smtp.email="you@gmail.com" smtp.password="your-app-password"
function getTransporter() {
  const config = functions.config();
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: config.smtp.email,
      pass: config.smtp.password,
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

  // Rate limit: max 5 OTPs per email per hour
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
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Zenith Fitness" <${functions.config().smtp.email}>`,
    to: normalizedEmail,
    subject: "Your Zenith Fitness Login Code",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #f97316, #dc2626); line-height: 48px; font-size: 24px; color: white;">🔥</div>
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
