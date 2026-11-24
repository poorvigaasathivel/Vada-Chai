import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mic, Square, Volume2, X } from 'lucide-react';
import { api } from '../api';
import {
  SUPPORTED_LANGUAGES,
  type ParsedVoiceExpense,
  type SupportedLanguage,
  type UserProfile,
} from '../types';
import { formatINR, generateRequestId } from '../utils/formatters';

interface VoiceExpenseModalProps {
  open: boolean;
  onClose: () => void;
  defaultLanguage: SupportedLanguage;
  availableBalance: number;
  onSuccess: (result: {
    user: UserProfile;
    triggeredLowBalance: boolean;
    lowBalanceMessage: string | null;
  }) => void;
}

export const VoiceExpenseModal: React.FC<VoiceExpenseModalProps> = ({
  open,
  onClose,
  defaultLanguage,
  availableBalance,
  onSuccess,
}) => {
  const [languageHint, setLanguageHint] = useState<string>('Auto-Detect');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedVoiceExpense | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [manualPhrase, setManualPhrase] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!open) {
      cleanupAudio();
      setRecording(false);
      setProcessing(false);
      setParsed(null);
      setError(null);
      setManualPhrase('');
    }
  }, [open]);

  function cleanupAudio() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
  }

  async function startRecording() {
    setError(null);
    setParsed(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Microphone recording is unavailable in this browser. Type your spoken phrase below instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Live audio level feedback
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 90) * 100)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType: preferredMime });
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        cleanupAudio();
        const blob = new Blob(chunksRef.current, { type: preferredMime });
        if (blob.size < 400) {
          setError('Recording was too short. Please hold or speak clearly for a moment.');
          return;
        }
        await processAudioBlob(blob, preferredMime.split(';')[0]);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      cleanupAudio();
      setError(
        'Could not access microphone. Allow mic permission in your browser, or enter your spoken sentence below.'
      );
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  async function processAudioBlob(blob: Blob, mimeType: string) {
    setProcessing(true);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const stripped = result.includes(',') ? result.split(',')[1] : result;
          resolve(stripped);
        };
        reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
        reader.readAsDataURL(blob);
      });

      const res = await api.voiceExpense({
        audioBase64: base64,
        mimeType,
        preferredLanguage: languageHint === 'Auto-Detect' ? defaultLanguage : languageHint,
      });

      setParsed(res);
      setEditAmount(String(res.amount));
      setEditDescription(res.description);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice interpretation failed.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleParseTypedPhrase(e: React.FormEvent) {
    e.preventDefault();
    if (!manualPhrase.trim() || processing) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await api.parseExpenseText({
        text: manualPhrase.trim(),
        preferredLanguage: languageHint === 'Auto-Detect' ? defaultLanguage : languageHint,
      });
      setParsed(res);
      setEditAmount(String(res.amount));
      setEditDescription(res.description);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse phrase.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleConfirmAndSave() {
    if (!parsed || saving) return;
    const numAmount = Number(editAmount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Please verify a valid rupee amount greater than 0.');
      return;
    }
    if (!editDescription.trim()) {
      setError('Please enter a description before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await api.addExpense({
        amount: numAmount,
        description: editDescription.trim(),
        source: 'voice',
        spokenLanguage: parsed.detectedLanguage,
        transcript: parsed.transcript,
        clientRequestId: generateRequestId(),
      });
      onSuccess(res);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save expense.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-expense-title"
    >
      <div className="pastel-card rounded-3xl w-full max-w-lg p-6 sm:p-7 relative max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="voice-expense-title" className="font-display text-2xl font-semibold">
              Voice Expense
            </h2>
            <p className="text-sm text-[var(--theme-muted)] mt-1">
              Speak naturally in Tamil, Hindi, Malayalam, Kannada, Telugu, English, or mixed speech.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close voice modal"
            className="p-2 rounded-xl hover:bg-[var(--theme-surface-alt)] text-[var(--theme-muted)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Language Hint Selector */}
        <div className="mb-5">
          <label htmlFor="voice-lang-select" className="block text-xs font-medium text-[var(--theme-muted)] mb-1.5">
            Speech Language Preference
          </label>
          <select
            id="voice-lang-select"
            value={languageHint}
            onChange={(e) => setLanguageHint(e.target.value)}
            disabled={recording || processing}
            className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
          >
            <option value="Auto-Detect">Auto-Detect (All 6 Languages &amp; Mixed Speech)</option>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang} (including mixed {lang}-English)
              </option>
            ))}
          </select>
        </div>

        {/* Step 1: Microphone Capture */}
        {!parsed && (
          <div className="space-y-5">
            <div className="pastel-surface-alt rounded-2xl p-6 border border-[var(--theme-border)] flex flex-col items-center text-center">
              <button
                type="button"
                disabled={processing}
                onClick={recording ? stopRecording : startRecording}
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-transform cursor-pointer shadow-sm ${
                  recording
                    ? 'bg-red-600 text-white scale-105'
                    : 'pastel-btn-primary'
                } disabled:opacity-60`}
                aria-label={recording ? 'Stop recording' : 'Start voice recording'}
              >
                {processing ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : recording ? (
                  <Square className="w-7 h-7 fill-current" />
                ) : (
                  <Mic className="w-8 h-8" />
                )}
              </button>

              {recording && (
                <div className="w-48 h-2 rounded-full bg-black/10 overflow-hidden mt-4">
                  <div
                    className="h-full bg-[var(--theme-accent)] transition-all duration-75"
                    style={{ width: `${Math.max(12, audioLevel)}%` }}
                  />
                </div>
              )}

              <p className="text-sm font-medium mt-4">
                {processing
                  ? 'Listening & extracting rupee amount...'
                  : recording
                    ? 'Listening now — tap to stop when done'
                    : 'Tap microphone and speak naturally'}
              </p>
              <p className="text-xs text-[var(--theme-muted)] mt-1.5 max-w-sm">
                Try: &ldquo;I spent 50 rupees on burger&rdquo;, &ldquo;Auto ku 80 ruba kuduthen&rdquo;,
                or &ldquo;Chai samosa ke 45 rupay diye&rdquo;
              </p>
            </div>

            {/* Natural Text / Accessibility Fallback */}
            <form onSubmit={handleParseTypedPhrase} className="pt-2 border-t border-[var(--theme-border)]">
              <label htmlFor="voice-text-fallback" className="block text-xs font-medium text-[var(--theme-muted)] mb-1.5">
                Or enter a natural multilingual sentence to extract
              </label>
              <div className="flex gap-2">
                <input
                  id="voice-text-fallback"
                  type="text"
                  value={manualPhrase}
                  onChange={(e) => setManualPhrase(e.target.value)}
                  placeholder="e.g. Dosa aur filter coffee 120 rupees"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                />
                <button
                  type="submit"
                  disabled={processing || !manualPhrase.trim()}
                  className="px-4 py-2.5 rounded-xl pastel-btn-soft text-sm font-medium disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  Interpret
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Step 2: AI Confirmation View */}
        {parsed && (
          <div className="space-y-4">
            <div className="pastel-surface-alt rounded-2xl p-4 border border-[var(--theme-border)]">
              <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)] mb-1">
                <Volume2 className="w-4 h-4 text-[var(--theme-accent)]" />
                <span>Heard ({parsed.detectedLanguage})</span>
              </div>
              <p className="text-sm italic text-[var(--theme-text)]">
                &ldquo;{parsed.transcript}&rdquo;
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="confirm-voice-amount" className="block text-sm font-medium mb-1.5">
                  Interpreted Amount (₹)
                </label>
                <input
                  id="confirm-voice-amount"
                  type="number"
                  step="0.01"
                  min="1"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] font-num text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                />
              </div>
              <div>
                <label htmlFor="confirm-voice-desc" className="block text-sm font-medium mb-1.5">
                  Expense Description
                </label>
                <input
                  id="confirm-voice-desc"
                  type="text"
                  maxLength={120}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                />
              </div>
            </div>

            <p className="text-xs text-[var(--theme-muted)]">
              Available balance after deduction:{' '}
              <span className="font-num font-semibold text-[var(--theme-text)]">
                {formatINR(Math.max(0, availableBalance - (Number(editAmount) || 0)))}
              </span>
            </p>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setParsed(null);
                  setError(null);
                }}
                className="py-2.5 px-4 rounded-xl pastel-btn-soft text-sm font-medium cursor-pointer"
              >
                Speak Again
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmAndSave}
                className="py-2.5 px-5 rounded-xl pastel-btn-primary text-sm font-medium flex items-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Confirm & Deduct'}</span>
              </button>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
