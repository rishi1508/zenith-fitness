import { useState, useRef, useEffect } from 'react';
import { Flame, Mail, Chrome, ArrowLeft, Loader2, User, Check } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

type Step = 'main' | 'otp-email' | 'otp-code' | 'otp-name';

export function LoginView({ isDark }: { isDark: boolean }) {
  const {
    signInWithGoogle,
    sendEmailOTP, verifyEmailOTP, completeProfile,
    enterGuestMode,
  } = useAuth();

  const [step, setStep] = useState<Step>('main');
  const [email, setEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend countdown timer
  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => setResendTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  const inputClass = `w-full rounded-xl px-4 py-3.5 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark
      ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white placeholder-zinc-500'
      : 'bg-white border-gray-200 placeholder-gray-400'
  }`;

  const subtleText = isDark ? 'text-zinc-400' : 'text-gray-500';

  // ---- Handlers ----

  const handleGoogle = async () => {
    setError('');
    setLoading('google');
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      if (!msg.includes('popup-closed-by-user') && !msg.includes('redirect-cancelled')) {
        setError(msg);
      }
    } finally {
      setLoading(null);
    }
  };

  const handleSendOTP = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setError('');
    setLoading('otp-send');
    try {
      await sendEmailOTP(email.trim());
      setStep('otp-code');
      setResendTimer(60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send code';
      setError(msg);
    } finally {
      setLoading(null);
    }
  };

  const handleResendOTP = async () => {
    if (resendTimer > 0) return;
    setError('');
    setLoading('otp-resend');
    try {
      await sendEmailOTP(email.trim());
      setResendTimer(60);
      setOtpDigits(['', '', '', '', '', '']);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setLoading(null);
    }
  };

  const handleVerifyOTP = async () => {
    const code = otpDigits.join('');
    if (code.length !== 6) {
      setError('Please enter the full 6-digit code');
      return;
    }
    setError('');
    setLoading('otp-verify');
    try {
      const { isNewUser } = await verifyEmailOTP(email.trim(), code);
      if (isNewUser) {
        setStep('otp-name');
      }
      // If not new user, onAuthStateChanged in AuthContext will handle the rest
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setError(msg);
    } finally {
      setLoading(null);
    }
  };

  const handleCompleteName = async () => {
    if (!firstName.trim()) {
      setError('First name is required');
      return;
    }
    setError('');
    setLoading('otp-name');
    try {
      const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
      await completeProfile(displayName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setLoading(null);
    }
  };

  // OTP input handler — auto-advance, paste support
  const handleOtpChange = (index: number, value: string) => {
    // Handle paste of full code
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').slice(0, 6).split('');
      const newOtp = [...otpDigits];
      digits.forEach((d, i) => {
        if (index + i < 6) newOtp[index + i] = d;
      });
      setOtpDigits(newOtp);
      const nextIndex = Math.min(index + digits.length, 5);
      otpRefs.current[nextIndex]?.focus();
      return;
    }

    const digit = value.replace(/\D/g, '');
    const newOtp = [...otpDigits];
    newOtp[index] = digit;
    setOtpDigits(newOtp);

    // Auto-advance to next input
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter' && otpDigits.join('').length === 6) {
      handleVerifyOTP();
    }
  };

  const goBack = () => {
    setError('');
    if (step === 'otp-code') setStep('otp-email');
    else if (step === 'otp-email') setStep('main');
    else setStep('main');
  };

  // ---- Render ----

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center px-6 ${isDark ? 'bg-[#0f0f0f] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Logo */}
      <div className="text-center mb-10">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-500/20">
          <Flame className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-bold">Zenith Fitness</h1>
        <p className={`text-sm mt-1 ${subtleText}`}>
          Track. Improve. Dominate.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        {/* ======== MAIN STEP ======== */}
        {step === 'main' && (
          <>
            {/* Google Sign-In */}
            <button
              onClick={handleGoogle}
              disabled={loading !== null}
              className={`w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl font-medium transition-colors border ${
                isDark
                  ? 'bg-white text-gray-900 hover:bg-gray-100 border-transparent'
                  : 'bg-white text-gray-900 hover:bg-gray-50 border-gray-200 shadow-sm'
              } disabled:opacity-50`}
            >
              {loading === 'google' ? (
                <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
              ) : (
                <Chrome className="w-5 h-5" />
              )}
              Continue with Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className={`flex-1 h-px ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`} />
              <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>or</span>
              <div className={`flex-1 h-px ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`} />
            </div>

            {/* Email OTP Option */}
            <button
              onClick={() => setStep('otp-email')}
              className={`w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl font-medium transition-colors bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90`}
            >
              <Mail className="w-5 h-5" />
              Continue with Email
            </button>

            {/* Guest Mode */}
            <button
              onClick={enterGuestMode}
              className={`w-full py-3 text-sm transition-colors ${isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Continue without an account
            </button>
            <p className={`text-xs text-center ${isDark ? 'text-zinc-600' : 'text-gray-400'}`}>
              Guest data stays on this device only
            </p>
          </>
        )}

        {/* ======== OTP - EMAIL STEP ======== */}
        {step === 'otp-email' && (
          <>
            <button onClick={goBack} className={`flex items-center gap-1 text-sm ${subtleText}`}>
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            <div className="text-center space-y-1">
              <h2 className="text-lg font-bold">Enter your email</h2>
              <p className={`text-sm ${subtleText}`}>
                We'll send a 6-digit verification code
              </p>
            </div>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
              placeholder="Email address"
              className={inputClass}
              autoFocus
            />

            <button
              onClick={handleSendOTP}
              disabled={loading !== null}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading === 'otp-send' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Mail className="w-5 h-5" />
              )}
              Send Code
            </button>
          </>
        )}

        {/* ======== OTP - CODE STEP ======== */}
        {step === 'otp-code' && (
          <>
            <button onClick={goBack} className={`flex items-center gap-1 text-sm ${subtleText}`}>
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            <div className="text-center space-y-1">
              <h2 className="text-lg font-bold">Enter verification code</h2>
              <p className={`text-sm ${subtleText}`}>
                Sent to <span className="text-orange-400 font-medium">{email}</span>
              </p>
            </div>

            {/* 6-digit OTP input */}
            <div className="flex justify-center gap-2">
              {otpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  onFocus={(e) => e.target.select()}
                  className={`w-12 h-14 text-center text-xl font-bold rounded-xl border focus:outline-none focus:border-orange-500 transition-colors ${
                    isDark
                      ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white'
                      : 'bg-white border-gray-200'
                  }`}
                  autoFocus={i === 0}
                />
              ))}
            </div>

            <button
              onClick={handleVerifyOTP}
              disabled={loading !== null || otpDigits.join('').length !== 6}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading === 'otp-verify' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Check className="w-5 h-5" />
              )}
              Verify & Sign In
            </button>

            {/* Resend */}
            <div className="text-center">
              {resendTimer > 0 ? (
                <p className={`text-sm ${subtleText}`}>
                  Resend code in {resendTimer}s
                </p>
              ) : (
                <button
                  onClick={handleResendOTP}
                  disabled={loading === 'otp-resend'}
                  className="text-sm text-orange-400 hover:text-orange-300 transition-colors disabled:opacity-50"
                >
                  {loading === 'otp-resend' ? 'Sending...' : "Didn't get the code? Resend"}
                </button>
              )}
            </div>
          </>
        )}

        {/* ======== OTP - NAME STEP (new users only) ======== */}
        {step === 'otp-name' && (
          <>
            <div className="text-center space-y-1">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center mx-auto mb-3">
                <User className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-lg font-bold">Welcome!</h2>
              <p className={`text-sm ${subtleText}`}>
                Tell us your name to get started
              </p>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name *"
                className={inputClass}
                autoFocus
              />
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCompleteName()}
                placeholder="Last name (optional)"
                className={inputClass}
              />
            </div>

            <button
              onClick={handleCompleteName}
              disabled={loading !== null || !firstName.trim()}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading === 'otp-name' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Flame className="w-5 h-5" />
              )}
              Let's Go!
            </button>
          </>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
