import {
  type FunctionDeclaration,
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  Type,
} from '@google/genai';
import type http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifySessionToken } from './auth.ts';
import { db, type TransactionRow, type UserRow } from './db.ts';

function getLiveClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const getBalanceSummaryTool: FunctionDeclaration = {
  name: 'get_balance_summary',
  description:
    'Get the user current available balance in INR, their 10% low-balance threshold, and their latest 5 transactions.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const recordExpenseTool: FunctionDeclaration = {
  name: 'record_expense',
  description:
    'Record a confirmed user expense in INR, deduct it from their balance, and trigger notifications.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      amount: {
        type: Type.NUMBER,
        description: 'Expense amount in Indian Rupees (positive number).',
      },
      description: {
        type: Type.STRING,
        description: 'Short description of what was purchased (e.g. Vada and Chai, Auto fare).',
      },
      language: {
        type: Type.STRING,
        description: 'Language spoken by the user (e.g. English, Tamil, Hindi, Malayalam, Kannada, Telugu).',
      },
    },
    required: ['amount', 'description'],
  },
};

export function attachLiveVoiceServer(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on('connection', async (clientWs: WebSocket, req: http.IncomingMessage) => {
    const parsedUrl = new URL(req.url ?? '/live', 'http://localhost');
    const token = parsedUrl.searchParams.get('token') ?? '';
    const userId = verifySessionToken(token);

    if (!userId) {
      clientWs.send(JSON.stringify({ error: 'Authentication required for live voice chat.' }));
      clientWs.close(4001, 'Unauthorized');
      return;
    }

    const user = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userId) as unknown as UserRow | undefined;

    if (!user) {
      clientWs.close(4001, 'User not found');
      return;
    }

    const ai = getLiveClient();
    if (!ai) {
      clientWs.send(
        JSON.stringify({ error: 'Gemini API key is not configured on the server.' })
      );
      clientWs.close(1011, 'API key missing');
      return;
    }

    const recentTx = db
      .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 5')
      .all(userId) as unknown as TransactionRow[];

    const recentSummary =
      recentTx.length > 0
        ? recentTx
            .map(
              (t) =>
                `${t.type === 'expense' ? '-' : '+'}₹${t.amount} (${t.description})`
            )
            .join(', ')
        : 'No transactions yet';

    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    try {
      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [getBalanceSummaryTool, recordExpenseTool] }],
          systemInstruction: `You are Vada & Chai, a warm, witty, Indian-inspired personal money companion having a real-time voice conversation with ${user.name}${user.city ? ` from ${user.city}` : ''}.
Current available balance: ₹${Number(user.balance).toLocaleString('en-IN')}.
Preferred language: ${user.preferred_language}.
Recent transactions: ${recentSummary}.

Guidelines:
- Speak naturally, warmly, and concisely in a conversational voice (1–3 short sentences per reply).
- Understand and respond comfortably in English, Tamil, Hindi, Malayalam, Kannada, Telugu, or natural mixed Indian speech matching the user.
- Use get_balance_summary when asked about balance or recent spending.
- Before calling record_expense for a new expense, confirm briefly or if the user explicitly asks to log/save an expense right away, call record_expense and tell them their updated balance with friendly Indian charm.`,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== 1) return;

            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ inputTranscript: content.inputTranscription.text })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ outputTranscript: content.outputTranscription.text })
              );
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }

            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }

            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
            }

            // Handle Live tool calls
            for (const call of message.toolCall?.functionCalls ?? []) {
              if (!call.name || !session) continue;

              if (call.name === 'get_balance_summary') {
                const freshUser = db
                  .prepare('SELECT * FROM users WHERE id = ?')
                  .get(userId) as unknown as UserRow;
                const latestTx = db
                  .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 5')
                  .all(userId) as unknown as TransactionRow[];

                session.sendToolResponse({
                  functionResponses: [
                    {
                      id: call.id,
                      name: call.name,
                      response: {
                        balanceInr: Number(freshUser.balance),
                        hasInitializedBalance: Boolean(freshUser.has_initialized_balance),
                        lowBalanceThresholdInr: Number(freshUser.reference_amount) * 0.1,
                        recentTransactions: latestTx.map((t) => ({
                          type: t.type,
                          amount: Number(t.amount),
                          description: t.description,
                        })),
                      },
                    },
                  ],
                });
              } else if (call.name === 'record_expense') {
                const args = (call.args ?? {}) as {
                  amount?: number;
                  description?: string;
                  language?: string;
                };
                const amt = Math.round(Number(args.amount ?? 0) * 100) / 100;
                const desc = String(args.description ?? 'Voice Expense').trim().slice(0, 120);
                const lang = args.language ? String(args.language).slice(0, 40) : 'Live Voice';

                let toolResult: Record<string, unknown> = { ok: false };

                try {
                  db.exec('BEGIN IMMEDIATE');
                  const freshUser = db
                    .prepare('SELECT * FROM users WHERE id = ?')
                    .get(userId) as unknown as UserRow;

                  if (!freshUser.has_initialized_balance) {
                    db.exec('ROLLBACK');
                    toolResult = {
                      ok: false,
                      error: 'User has not set an opening available balance yet.',
                    };
                  } else if (!Number.isFinite(amt) || amt <= 0) {
                    db.exec('ROLLBACK');
                    toolResult = { ok: false, error: 'Expense amount must be greater than zero.' };
                  } else if (amt > Number(freshUser.balance)) {
                    db.exec('ROLLBACK');
                    toolResult = {
                      ok: false,
                      error: `Insufficient balance. Current balance is ₹${Number(freshUser.balance)}.`,
                    };
                  } else {
                    const newBalance = Math.round((Number(freshUser.balance) - amt) * 100) / 100;
                    const threshold = Number(freshUser.reference_amount) * 0.1;
                    const triggeredLow =
                      Number(freshUser.reference_amount) > 0 &&
                      newBalance <= threshold &&
                      !freshUser.low_balance_alert_sent;
                    const now = new Date().toISOString();

                    db.prepare(
                      'UPDATE users SET balance = ?, low_balance_alert_sent = ? WHERE id = ?'
                    ).run(
                      newBalance,
                      triggeredLow ? 1 : freshUser.low_balance_alert_sent,
                      userId
                    );

                    db.prepare(`
                      INSERT INTO transactions (user_id, type, amount, description, source, spoken_language, balance_after, created_at)
                      VALUES (?, 'expense', ?, ?, 'voice', ?, ?, ?)
                    `).run(userId, amt, desc, lang, newBalance, now);

                    db.prepare(`
                      INSERT INTO notifications (user_id, kind, title, message, is_read, created_at)
                      VALUES (?, 'expense', ?, ?, 0, ?)
                    `).run(
                      userId,
                      'Live Voice Expense Recorded',
                      `Spent ₹${amt.toLocaleString('en-IN')} on ${desc}. Remaining balance: ₹${newBalance.toLocaleString('en-IN')}.`,
                      now
                    );

                    if (triggeredLow) {
                      db.prepare(`
                        INSERT INTO notifications (user_id, kind, title, message, is_read, created_at)
                        VALUES (?, 'low_balance', ?, ?, 0, ?)
                      `).run(
                        userId,
                        'Low Balance Alert (10% Reached)',
                        `Chai-pani alert! Your purse is down to ₹${newBalance.toLocaleString('en-IN')} — time to top up your Vada & Chai wallet!`,
                        now
                      );
                    }

                    db.exec('COMMIT');
                    toolResult = {
                      ok: true,
                      amount: amt,
                      description: desc,
                      remainingBalanceInr: newBalance,
                      triggeredLowBalance: triggeredLow,
                    };

                    clientWs.send(
                      JSON.stringify({
                        balanceUpdated: true,
                        amount: amt,
                        description: desc,
                        remainingBalance: newBalance,
                        triggeredLowBalance: triggeredLow,
                      })
                    );
                  }
                } catch (err) {
                  try {
                    db.exec('ROLLBACK');
                  } catch {
                    // ignore
                  }
                  toolResult = {
                    ok: false,
                    error: err instanceof Error ? err.message : 'Database error.',
                  };
                }

                session.sendToolResponse({
                  functionResponses: [
                    {
                      id: call.id,
                      name: call.name,
                      response: toolResult,
                    },
                  ],
                });
              }
            }
          },
          onerror: (err) => {
            if (clientWs.readyState === 1) {
              clientWs.send(
                JSON.stringify({
                  error: err instanceof Error ? err.message : 'Live session error occurred.',
                })
              );
            }
          },
          onclose: () => {
            if (clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ closed: true }));
            }
          },
        },
      });

      clientWs.send(JSON.stringify({ ready: true }));
    } catch (err) {
      if (clientWs.readyState === 1) {
        clientWs.send(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Could not start Gemini Live session.',
          })
        );
        clientWs.close(1011, 'Live init failed');
      }
      return;
    }

    clientWs.on('message', (raw) => {
      if (!session) return;
      try {
        const msg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
        if (typeof msg.audio === 'string' && msg.audio.length > 0) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
          session.sendRealtimeInput({ text: msg.text.trim() });
        }
      } catch {
        // ignore malformed frames
      }
    });

    clientWs.on('close', () => {
      try {
        session?.close();
      } catch {
        // ignore close error
      }
      session = null;
    });
  });
}
