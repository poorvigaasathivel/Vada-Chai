import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio, Send, Volume2, X } from 'lucide-react';
import { getAuthToken } from '../api';
import type { UserProfile } from '../types';
import { formatINR } from '../utils/formatters';

interface LiveConversationModalProps {
  open: boolean;
  onClose: () => void;
  user: UserProfile;
  onBalanceUpdated: () => Promise<void>;
}

interface ChatLine {
  id: string;
  speaker: 'you' | 'assistant' | 'system';
  text: string;
}

function pcmFloat32ToBase64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const samples = Math.floor(bytes.length / 2);
  const float32 = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    float32[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return float32;
}

export const LiveConversationModal: React.FC<LiveConversationModalProps> = ({
  open,
  onClose,
  user,
  onBalanceUpdated,
}) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [textInput, setTextInput] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mutedRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    if (!open) {
      teardownSession();
      setStatus('idle');
      setMuted(false);
      setError(null);
      setLines([]);
      setTextInput('');
    }
  }, [open]);

  function stopQueuedPlayback() {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }

  function playOutputPcmChunk(base64: string) {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const float32 = base64PcmToFloat32(base64);
    if (float32.length === 0) return;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
    };
  }

  function appendTranscript(speaker: 'you' | 'assistant' | 'system', text: string) {
    const clean = text.trim();
    if (!clean) return;
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker && speaker !== 'system') {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: `${last.text} ${clean}`.replace(/\s+/g, ' ').trim(),
        };
        return updated;
      }
      return [...prev, { id: `${Date.now()}-${Math.random()}`, speaker, text: clean }];
    });
  }

  function teardownSession() {
    stopQueuedPlayback();
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current && inputCtxRef.current.state !== 'closed') {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current && outputCtxRef.current.state !== 'closed') {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  }

  async function startLiveSession() {
    const token = getAuthToken();
    if (!token) {
      setError('Please sign in again before starting a live voice chat.');
      return;
    }

    setStatus('connecting');
    setError(null);
    setLines([]);

    try {
      const inputAudioCtx = new AudioContext({ sampleRate: 16000 });
      const outputAudioCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputAudioCtx;
      outputCtxRef.current = outputAudioCtx;
      nextStartTimeRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/live?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const source = inputAudioCtx.createMediaStreamSource(stream);
        const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (ev) => {
          if (mutedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            return;
          }
          const base64 = pcmFloat32ToBase64(ev.inputBuffer.getChannelData(0));
          wsRef.current.send(JSON.stringify({ audio: base64 }));
        };

        source.connect(processor);
        processor.connect(inputAudioCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            ready?: boolean;
            audio?: string;
            inputTranscript?: string;
            outputTranscript?: string;
            interrupted?: boolean;
            balanceUpdated?: boolean;
            amount?: number;
            description?: string;
            remainingBalance?: number;
            error?: string;
            closed?: boolean;
          };

          if (msg.ready) {
            setStatus('connected');
            appendTranscript(
              'system',
              'Connected live! Ask about your balance or tell Vada & Chai what you spent.'
            );
          }
          if (msg.audio) {
            playOutputPcmChunk(msg.audio);
          }
          if (msg.interrupted) {
            stopQueuedPlayback();
          }
          if (msg.inputTranscript) {
            appendTranscript('you', msg.inputTranscript);
          }
          if (msg.outputTranscript) {
            appendTranscript('assistant', msg.outputTranscript);
          }
          if (msg.balanceUpdated) {
            appendTranscript(
              'system',
              `Saved ₹${Number(msg.amount ?? 0).toLocaleString('en-IN')} (${msg.description ?? 'Expense'}) · New balance: ${formatINR(Number(msg.remainingBalance ?? 0))}`
            );
            onBalanceUpdated().catch(() => {});
          }
          if (msg.error) {
            setError(msg.error);
            setStatus('error');
          }
          if (msg.closed && status === 'connected') {
            teardownSession();
            setStatus('idle');
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        setError('Live voice connection interrupted. Please try reconnecting.');
        setStatus('error');
        teardownSession();
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          teardownSession();
          setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
        }
      };
    } catch (err) {
      teardownSession();
      setStatus('error');
      setError(
        err instanceof Error
          ? err.message
          : 'Microphone permission is required for real-time voice conversations.'
      );
    }
  }

  function handleSendText(e: React.FormEvent) {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: clean }));
    appendTranscript('you', clean);
    setTextInput('');
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-chat-title"
    >
      <div className="pastel-card rounded-3xl w-full max-w-lg p-6 sm:p-7 flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Radio
                className={`w-4 h-4 ${
                  status === 'connected' ? 'text-emerald-600' : 'text-[var(--theme-accent)]'
                }`}
              />
              <h2 id="live-chat-title" className="font-display text-2xl font-semibold">
                Live Voice Companion
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[var(--theme-muted)] mt-1">
              Talk in real time about your balance ({formatINR(user.balance)}) or log expenses
              hands-free.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              teardownSession();
              onClose();
            }}
            aria-label="Close live voice chat"
            className="p-2 rounded-xl hover:bg-[var(--theme-surface-alt)] text-[var(--theme-muted)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Transcript Feed */}
        <div className="pastel-surface-alt rounded-2xl border border-[var(--theme-border)] p-4 flex-1 min-h-[220px] max-h-[320px] overflow-y-auto space-y-3 mb-4">
          {lines.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-8 px-4">
              <Volume2 className="w-8 h-8 text-[var(--theme-accent)] mb-2 opacity-80" />
              <p className="text-sm font-medium">Real-time voice conversation with Vada &amp; Chai</p>
              <p className="text-xs text-[var(--theme-muted)] mt-1 max-w-sm">
                Tap &ldquo;Start Live Chat&rdquo; below, then speak in Tamil, Hindi, Malayalam,
                Kannada, Telugu, or English. Ask &ldquo;What&apos;s my balance?&rdquo; or say
                &ldquo;Log 40 rupees for filter coffee.&rdquo;
              </p>
            </div>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className={`text-sm rounded-2xl px-3.5 py-2.5 ${
                  line.speaker === 'you'
                    ? 'bg-[var(--theme-surface)] border border-[var(--theme-border)] ml-8'
                    : line.speaker === 'system'
                      ? 'bg-[var(--theme-accent-soft)] text-xs text-[var(--theme-text)] text-center'
                      : 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)] mr-8'
                }`}
              >
                {line.speaker !== 'system' && (
                  <span className="block text-[11px] opacity-75 mb-0.5">
                    {line.speaker === 'you' ? 'You' : 'Vada & Chai'}
                  </span>
                )}
                <p className="leading-relaxed">{line.text}</p>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>

        {error && (
          <div role="alert" className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Controls */}
        {status === 'connected' ? (
          <div className="space-y-3">
            <form onSubmit={handleSendText} className="flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Or type a message into the live conversation..."
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
              />
              <button
                type="submit"
                disabled={!textInput.trim()}
                aria-label="Send message"
                className="px-3.5 py-2.5 rounded-xl pastel-btn-soft disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className="flex-1 py-3 px-4 rounded-2xl pastel-btn-soft text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
              >
                {muted ? <MicOff className="w-4 h-4 text-red-600" /> : <Mic className="w-4 h-4 text-[var(--theme-accent)]" />}
                <span>{muted ? 'Unmute Mic' : 'Mute Mic'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  teardownSession();
                  setStatus('idle');
                }}
                className="flex-1 py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End Call</span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={status === 'connecting'}
            onClick={startLiveSession}
            className="w-full py-3.5 px-5 rounded-2xl pastel-btn-primary text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            <Mic className="w-4 h-4" />
            <span>{status === 'connecting' ? 'Connecting Live Audio...' : 'Start Live Voice Chat'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
