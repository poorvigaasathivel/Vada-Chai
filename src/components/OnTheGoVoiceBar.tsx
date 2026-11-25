import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mic, MicOff, Send, Square, Volume2, X } from 'lucide-react';
import { api } from '../api';
import {
  SUPPORTED_LANGUAGES,
  type ParsedVoiceExpense,
  type SupportedLanguage,
  type UserProfile,
} from '../types';
import { formatINR, generateRequestId } from '../utils/formatters';

interface OnTheGoVoiceBarProps {
  active: boolean;
  onToggleOff: () => void;
  defaultLanguage: SupportedLanguage;
  availableBalance: number;
  onExpenseSaved: (result: {
    user: UserProfile;
    triggeredLowBalance: boolean;
    lowBalanceMessage: string | null;
    amount: number;
    description: string;
  }) => Promise<void>;
}

export const OnTheGoVoiceBar: React.FC<OnTheGoVoiceBarProps> = ({
  active,
  onToggleOff,
  defaultLanguage,
  availableBalance,
  onExpenseSaved,
}) => {
  const [languageHint, setLanguageHint] = useState<string>('Auto-Detect');
  const [autoSaveHandsFree, setAutoSaveHandsFree] = useState(false);
  const [listeningState, setListeningState] = useState<
    'idle' | 'listening' | 'speech' | 'processing' | 'confirming'
  >('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [parsed, setParsed] = useState<ParsedVoiceExpense | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [quickPhrase, setQuickPhrase] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(active);
  const autoSaveRef = useRef(autoSaveHandsFree);
  const langRef = useRef(languageHint);
  const defaultLangRef = useRef(defaultLanguage);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const hadSpeechRef = useRef(false);
  const speechStartedAtRef = useRef(0);
  const lastVoiceAtRef = useRef(0);
  const cycleStartedAtRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    autoSaveRef.current = autoSaveHandsFree;
  }, [autoSaveHandsFree]);

  useEffect(() => {
    langRef.current = languageHint;
  }, [languageHint]);

  useEffect(() => {
    defaultLangRef.current = defaultLanguage;
  }, [defaultLanguage]);

  const stopAllAudio = useCallback(() => {
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const saveExpensePayload = useCallback(
    async (payload: {
      amount: number;
      description: string;
      detectedLanguage: string;
      transcript: string;
    }) => {
      setSaving(true);
      setError(null);
      try {
        const res = await api.addExpense({
          amount: payload.amount,
          description: payload.description,
          source: 'voice',
          spokenLanguage: payload.detectedLanguage,
          transcript: payload.transcript,
          clientRequestId: generateRequestId(),
        });
        await onExpenseSaved({
          ...res,
          amount: payload.amount,
          description: payload.description,
        });
        setParsed(null);
        setEditAmount('');
        setEditDescription('');
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to save voice expense.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [onExpenseSaved]
  );

  const startUtteranceCycle = useCallback(() => {
    if (!activeRef.current || !streamRef.current) return;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return;

    const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

    const recorder = new MediaRecorder(streamRef.current, { mimeType: preferredMime });
    chunksRef.current = [];
    hadSpeechRef.current = false;
    speechStartedAtRef.current = 0;
    lastVoiceAtRef.current = 0;
    cycleStartedAtRef.current = Date.now();

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = async () => {
      if (!activeRef.current) return;
      const spoke = hadSpeechRef.current;
      const blob = new Blob(chunksRef.current, { type: preferredMime });

      if (!spoke || blob.size < 400) {
        // Silent window — recycle cleanly without calling API
        restartTimerRef.current = window.setTimeout(() => {
          if (activeRef.current) startUtteranceCycle();
        }, 120);
        return;
      }

      setListeningState('processing');
      setError(null);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const stripped = result.includes(',') ? result.split(',')[1] : result;
            resolve(stripped);
          };
          reader.onerror = () => reject(new Error('Failed to read audio clip.'));
          reader.readAsDataURL(blob);
        });

        const res = await api.voiceExpense({
          audioBase64: base64,
          mimeType: preferredMime.split(';')[0],
          preferredLanguage:
            langRef.current === 'Auto-Detect' ? defaultLangRef.current : langRef.current,
        });

        if (!activeRef.current) return;

        if (autoSaveRef.current) {
          const saved = await saveExpensePayload(res);
          if (saved && activeRef.current) {
            setListeningState('listening');
            startUtteranceCycle();
            return;
          }
        }

        setParsed(res);
        setEditAmount(String(res.amount));
        setEditDescription(res.description);
        setListeningState('confirming');
      } catch (err) {
        if (!activeRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not catch that expense.');
        setListeningState('listening');
        restartTimerRef.current = window.setTimeout(() => {
          if (activeRef.current) startUtteranceCycle();
        }, 350);
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setListeningState('listening');
  }, [saveExpensePayload]);

  const startHandsFreeMic = useCallback(async () => {
    setError(null);
    setParsed(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Microphone unavailable in this browser. Type your natural phrase below instead.');
      setListeningState('idle');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const timeDomain = new Float32Array(analyser.fftSize);

      const monitor = () => {
        if (!activeRef.current || !audioCtxRef.current) return;
        analyser.getFloatTimeDomainData(timeDomain);
        let sumSq = 0;
        for (let i = 0; i < timeDomain.length; i++) {
          sumSq += timeDomain[i] * timeDomain[i];
        }
        const rms = Math.sqrt(sumSq / timeDomain.length);
        const level = Math.min(100, Math.round(rms * 420));
        setAudioLevel(level);

        const rec = recorderRef.current;
        if (rec && rec.state === 'recording') {
          const now = Date.now();
          if (rms > 0.014) {
            if (!hadSpeechRef.current) {
              hadSpeechRef.current = true;
              speechStartedAtRef.current = now;
              setListeningState('speech');
            }
            lastVoiceAtRef.current = now;
          }

          if (hadSpeechRef.current) {
            const silentMs = now - lastVoiceAtRef.current;
            const totalSpeechMs = now - speechStartedAtRef.current;
            if ((silentMs > 1350 && totalSpeechMs > 500) || totalSpeechMs > 12000) {
              rec.stop();
            }
          } else if (now - cycleStartedAtRef.current > 8000) {
            // Refresh silent buffer so WebM clip stays short
            rec.stop();
          }
        }

        rafRef.current = requestAnimationFrame(monitor);
      };

      startUtteranceCycle();
      monitor();
    } catch {
      stopAllAudio();
      setListeningState('idle');
      setError(
        'Microphone permission is blocked. Allow mic access or type a natural sentence below.'
      );
    }
  }, [startUtteranceCycle, stopAllAudio]);

  useEffect(() => {
    if (active) {
      startHandsFreeMic();
    } else {
      stopAllAudio();
      setListeningState('idle');
      setParsed(null);
      setError(null);
    }
    return () => {
      stopAllAudio();
    };
  }, [active, startHandsFreeMic, stopAllAudio]);

  function handleCaptureNow() {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      hadSpeechRef.current = true;
      rec.stop();
    }
  }

  async function handleConfirmAndSave() {
    if (!parsed || saving) return;
    const numAmount = Number(editAmount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Please enter a valid rupee amount greater than 0.');
      return;
    }
    if (!editDescription.trim()) {
      setError('Please enter an expense description.');
      return;
    }
    const ok = await saveExpensePayload({
      amount: numAmount,
      description: editDescription.trim(),
      detectedLanguage: parsed.detectedLanguage,
      transcript: parsed.transcript,
    });
    if (ok && activeRef.current) {
      setListeningState('listening');
      startUtteranceCycle();
    }
  }

  async function handleQuickTextParse(e: React.FormEvent) {
    e.preventDefault();
    if (!quickPhrase.trim() || listeningState === 'processing') return;
    setError(null);
    setListeningState('processing');
    try {
      const res = await api.parseExpenseText({
        text: quickPhrase.trim(),
        preferredLanguage: languageHint === 'Auto-Detect' ? defaultLanguage : languageHint,
      });
      setQuickPhrase('');
      if (autoSaveHandsFree) {
        const ok = await saveExpensePayload(res);
        if (ok && activeRef.current) {
          setListeningState('listening');
          startUtteranceCycle();
          return;
        }
      }
      setParsed(res);
      setEditAmount(String(res.amount));
      setEditDescription(res.description);
      setListeningState('confirming');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not interpret phrase.');
      setListeningState('listening');
    }
  }

  if (!active) return null;

  return (
    <section
      aria-label="On-the-go Voice Expense"
      className="pastel-card rounded-3xl p-5 sm:p-6 border-2 border-[var(--theme-accent)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl pastel-btn-primary flex items-center justify-center shrink-0">
            {listeningState === 'processing' ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="font-display text-lg sm:text-xl font-semibold">
                Voice Expense Active (On the Go)
              </h2>
              <span className="text-xs font-medium text-[var(--theme-accent)]">
                {listeningState === 'speech'
                  ? 'Hearing you speak...'
                  : listeningState === 'processing'
                    ? 'Understanding natural language...'
                    : listeningState === 'confirming'
                      ? 'Ready to confirm'
                      : 'Listening hands-free'}
              </span>
            </div>
            <p className="text-xs text-[var(--theme-muted)] mt-0.5">
              Speak naturally in Tamil, Hindi, Malayalam, Kannada, Telugu, English, or mixed
              speech — e.g. &ldquo;Auto ku 50 ruba&rdquo; or &ldquo;Chai aur vada 40 rupees&rdquo;.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleOff}
          className="py-2 px-3.5 rounded-xl pastel-btn-soft text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <MicOff className="w-3.5 h-3.5" />
          <span>Turn Off Voice</span>
        </button>
      </div>

      {/* Live Mic Level & Quick Controls */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center mb-4">
        <div className="md:col-span-4">
          <label htmlFor="onthego-lang" className="sr-only">
            Voice Language
          </label>
          <select
            id="onthego-lang"
            value={languageHint}
            onChange={(e) => setLanguageHint(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
          >
            <option value="Auto-Detect">Auto-Detect (All 6 + Mixed)</option>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang} (Natural &amp; Mixed)
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-4 flex items-center gap-3">
          <div
            className="flex-1 h-2.5 rounded-full bg-[var(--theme-surface-alt)] border border-[var(--theme-border)] overflow-hidden"
            aria-label="Microphone audio level"
          >
            <div
              className="h-full transition-all duration-75"
              style={{
                width: `${Math.max(6, audioLevel)}%`,
                backgroundColor:
                  listeningState === 'speech' ? '#16A34A' : 'var(--theme-accent)',
              }}
            />
          </div>
          {listeningState === 'listening' || listeningState === 'speech' ? (
            <button
              type="button"
              onClick={handleCaptureNow}
              className="py-2 px-3 rounded-xl pastel-btn-primary text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Capture Now</span>
            </button>
          ) : null}
        </div>

        <label className="md:col-span-4 flex items-center gap-2 text-xs text-[var(--theme-text)] cursor-pointer select-none md:justify-end">
          <input
            type="checkbox"
            checked={autoSaveHandsFree}
            onChange={(e) => setAutoSaveHandsFree(e.target.checked)}
            className="w-4 h-4 accent-[var(--theme-accent)] rounded"
          />
          <span>Auto-save immediately hands-free</span>
        </label>
      </div>

      {/* Confirmation Card when an expense is extracted */}
      {parsed && (
        <div className="pastel-surface-alt rounded-2xl p-4 border border-[var(--theme-border)] mb-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
              <Volume2 className="w-4 h-4 text-[var(--theme-accent)]" />
              <span>
                Heard ({parsed.detectedLanguage}): &ldquo;{parsed.transcript}&rdquo;
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setParsed(null);
                setListeningState('listening');
                startUtteranceCycle();
              }}
              aria-label="Discard and listen again"
              className="p-1 rounded-lg hover:bg-black/5 text-[var(--theme-muted)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-3">
              <label htmlFor="onthego-amount" className="block text-xs font-medium mb-1">
                Amount (₹)
              </label>
              <input
                id="onthego-amount"
                type="number"
                step="0.01"
                min="1"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] font-num text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
              />
            </div>
            <div className="sm:col-span-5">
              <label htmlFor="onthego-desc" className="block text-xs font-medium mb-1">
                Description
              </label>
              <input
                id="onthego-desc"
                type="text"
                maxLength={120}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
              />
            </div>
            <div className="sm:col-span-4 flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmAndSave}
                className="flex-1 py-2.5 px-4 rounded-xl pastel-btn-primary text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer whitespace-nowrap"
              >
                <Check className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Confirm & Deduct'}</span>
              </button>
            </div>
          </div>

          <p className="text-xs text-[var(--theme-muted)]">
            Balance after expense:{' '}
            <span className="font-num font-semibold text-[var(--theme-text)]">
              {formatINR(Math.max(0, availableBalance - (Number(editAmount) || 0)))}
            </span>
          </p>
        </div>
      )}

      {/* Natural Language Quick Input Fallback */}
      <form onSubmit={handleQuickTextParse} className="flex gap-2">
        <input
          type="text"
          value={quickPhrase}
          onChange={(e) => setQuickPhrase(e.target.value)}
          placeholder="Or type in any natural language (e.g. 'Vada chai 45 ruba', 'Auto 80 rupay')"
          className="flex-1 px-3.5 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
        />
        <button
          type="submit"
          disabled={!quickPhrase.trim() || listeningState === 'processing'}
          className="px-4 py-2 rounded-xl pastel-btn-soft text-xs sm:text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Log</span>
        </button>
      </form>

      {error && (
        <div role="alert" className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm">
          {error}
        </div>
      )}
    </section>
  );
};
