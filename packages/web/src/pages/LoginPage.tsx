import React, { useState, useRef } from 'react';
import { ArrowRight, KeyRound, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '../store/authStore.js';
import { Logo } from '../components/ui/Logo.js';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, verify2FA } = useAuthStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await login(username, password);
      if (res.requires2FA && res.tempToken) {
        setTempToken(res.tempToken);
        setStep('2fa');
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } catch (err: any) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;
    setError(null);
    setLoading(true);

    try {
      const cleanCode = totpCode.trim();
      await verify2FA(tempToken, cleanCode);
    } catch (err: any) {
      setError(err.message || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToCredentials = () => {
    setStep('credentials');
    setTempToken(null);
    setTotpCode('');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-6">
          <Logo size={68} className="mb-2" />
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">PM2 Web UI</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Sign in to your cluster</p>
        </div>

        {/* Login Card */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300">
              {error}
            </div>
          )}

          {step === 'credentials' ? (
            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Username or Email
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="admin"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 bg-zinc-100 hover:bg-white text-zinc-950 font-medium py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign In'}
                {!loading && <ArrowRight size={15} />}
              </button>
            </form>
          ) : (
            <form onSubmit={handle2FASubmit} className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={handleBackToCredentials}
                  className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors rounded"
                  title="Back to login"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                  <KeyRound size={14} className="text-emerald-400" /> Two-Factor Authentication
                </div>
              </div>

              <p className="text-xs text-zinc-400">
                {isRecoveryMode
                  ? 'Enter one of your 12-character emergency backup recovery codes.'
                  : 'Enter the 6-digit code from your authenticator app.'}
              </p>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  {isRecoveryMode ? 'Recovery Code' : '6-Digit TOTP Code'}
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  maxLength={isRecoveryMode ? 24 : 10}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  required
                  placeholder={isRecoveryMode ? 'XXXX-XXXX-XXXX' : '123 456'}
                  autoFocus
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-center tracking-widest text-lg font-mono text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={
                  loading ||
                  (isRecoveryMode
                    ? totpCode.replace(/[\s-]+/g, '').length < 6
                    : totpCode.replace(/[\s-]+/g, '').length !== 6)
                }
                className="w-full mt-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40"
              >
                {loading ? 'Verifying...' : 'Verify'}
                {!loading && <ArrowRight size={15} />}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecoveryMode(!isRecoveryMode);
                    setTotpCode('');
                    setError(null);
                  }}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 underline transition-colors"
                >
                  {isRecoveryMode
                    ? 'Use 6-digit authenticator code'
                    : 'Use emergency recovery code'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
