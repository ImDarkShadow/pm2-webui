import React, { useState, useEffect } from 'react';
import { ShieldCheck, Copy, Check, Download, AlertTriangle, ArrowRight, X } from 'lucide-react';
import { QrCodeSvg } from '../ui/QrCodeSvg.js';
import { api } from '../../api/client.js';

export interface TwoFactorSetupModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onEnabled: () => void;
}

export const TwoFactorSetupModal: React.FC<TwoFactorSetupModalProps> = ({
  isOpen,
  onClose,
  onEnabled,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauthUri: string;
    recoveryCodes: readonly string[];
  } | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setCode('');
      setError(null);
      setLoading(true);
      api
        .setup2FA()
        .then((data) => {
          setSetupData(data);
        })
        .catch((err) => {
          setError(err.message || 'Failed to initialize 2FA setup');
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyKey = () => {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.secret);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCopyCodes = () => {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.recoveryCodes.join('\n'));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  const handleDownloadCodes = () => {
    if (!setupData) return;
    const content = `PM2 CLUSTER MANAGER - EMERGENCY RECOVERY CODES\nGenerated: ${new Date().toISOString()}\n\nEach code can only be used once:\n\n${setupData.recoveryCodes.join('\n')}\n\nKeep these codes in a safe place.`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pm2-recovery-codes-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleVerifyAndEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupData) return;
    setError(null);
    setLoading(true);

    try {
      const cleanCode = code.replace(/[\s-]+/g, '').trim();
      await api.enable2FA(setupData.secret, cleanCode, setupData.recoveryCodes as string[]);
      setStep(3); // Go to recovery codes display
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = () => {
    onEnabled();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Set up two-factor authentication
              </h2>
              <p className="text-[11px] text-zinc-500">Step {step} of 3</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-600 dark:text-rose-300">
            {error}
          </div>
        )}

        {/* Step 1: Scan QR Code */}
        {step === 1 && setupData && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              Scan this QR code with your authenticator app (e.g. Google Authenticator, 1Password,
              Authy):
            </p>

            <div className="flex flex-col items-center justify-center p-4 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <div className="p-2 bg-white rounded-lg shadow-sm">
                <QrCodeSvg value={setupData.otpauthUri} size={180} />
              </div>
              <div className="mt-3 text-center">
                <span className="text-[11px] text-zinc-500">Or enter this key manually:</span>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <code className="text-xs font-mono font-bold bg-zinc-200 dark:bg-zinc-800 px-2 py-1 rounded text-zinc-800 dark:text-zinc-200 tracking-wider select-all">
                    {setupData.secret}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    className="p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    title="Copy Secret"
                  >
                    {copiedKey ? (
                      <Check size={14} className="text-emerald-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-zinc-100 dark:text-zinc-950 text-xs font-semibold rounded-lg transition-colors"
              >
                Continue <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Enter 6-Digit Code */}
        {step === 2 && (
          <form onSubmit={handleVerifyAndEnable} className="space-y-4">
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              Enter the 6-digit code shown in your authenticator app:
            </p>

            <div>
              <input
                type="text"
                maxLength={10}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123 456"
                autoFocus
                required
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-3 text-center tracking-widest text-xl font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || code.replace(/[\s-]+/g, '').length !== 6}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40"
              >
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Emergency Backup Recovery Codes */}
        {step === 3 && setupData && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
              <span>
                <strong>Save your recovery codes.</strong> If you lose access to your authenticator
                device, these single-use codes are the only way to sign in.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-xs text-zinc-800 dark:text-zinc-200">
              {setupData.recoveryCodes.map((rc, idx) => (
                <div
                  key={idx}
                  className="p-1.5 bg-white dark:bg-zinc-900 rounded border border-zinc-200/60 dark:border-zinc-800 text-center select-all"
                >
                  {rc}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleCopyCodes}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 transition-colors"
              >
                {copiedCodes ? (
                  <Check size={13} className="text-emerald-500" />
                ) : (
                  <Copy size={13} />
                )}
                {copiedCodes ? 'Copied' : 'Copy All'}
              </button>
              <button
                type="button"
                onClick={handleDownloadCodes}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 transition-colors"
              >
                <Download size={13} /> Download .txt
              </button>
            </div>

            <div className="flex justify-end pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={handleFinish}
                className="px-5 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-zinc-100 dark:text-zinc-950 text-xs font-semibold rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
