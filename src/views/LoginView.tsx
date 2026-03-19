import { useState } from 'react';
import { Flame, Mail, Chrome, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export function LoginView({ isDark }: { isDark: boolean }) {
  const { signInWithGoogle, signInOrRegisterWithEmail, enterGuestMode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<'google' | 'email' | null>(null);

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

  const handleEmailPassword = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setError('');
    setLoading('email');
    try {
      await signInOrRegisterWithEmail(email.trim(), password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center px-6 ${isDark ? 'bg-[#0f0f0f] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Logo & Branding */}
      <div className="text-center mb-10">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-500/20">
          <Flame className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-bold">Zenith Fitness</h1>
        <p className={`text-sm mt-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          Track. Improve. Dominate.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4">
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
            <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          ) : (
            <Chrome className="w-5 h-5" />
          )}
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className={`flex-1 h-px ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`} />
          <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>or sign in with email</span>
          <div className={`flex-1 h-px ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`} />
        </div>

        {/* Email + Password */}
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className={`w-full rounded-xl px-4 py-3.5 text-sm border focus:outline-none focus:border-orange-500 ${
              isDark
                ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white placeholder-zinc-500'
                : 'bg-white border-gray-200 placeholder-gray-400'
            }`}
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEmailPassword()}
              placeholder="Password (min 6 characters)"
              className={`w-full rounded-xl px-4 py-3.5 pr-12 text-sm border focus:outline-none focus:border-orange-500 ${
                isDark
                  ? 'bg-[#1a1a1a] border-[#2e2e2e] text-white placeholder-zinc-500'
                  : 'bg-white border-gray-200 placeholder-gray-400'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={handleEmailPassword}
            disabled={loading !== null}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading === 'email' ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Mail className="w-5 h-5" />
            )}
            Sign In / Register
          </button>
          <p className={`text-xs text-center ${isDark ? 'text-zinc-600' : 'text-gray-400'}`}>
            New users are automatically registered
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 text-center">
            {error}
          </div>
        )}

        {/* Skip / Guest Mode */}
        <button
          onClick={enterGuestMode}
          className={`w-full py-3 text-sm transition-colors ${isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-gray-400 hover:text-gray-600'}`}
        >
          Continue without an account
        </button>
        <p className={`text-xs text-center ${isDark ? 'text-zinc-600' : 'text-gray-400'}`}>
          Guest data stays on this device only
        </p>
      </div>
    </div>
  );
}
