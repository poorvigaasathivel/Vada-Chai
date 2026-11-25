import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 12000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  );
}

function formatGeminiError(err: unknown, fallback: string): Error {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string } };
    if (parsed?.error?.code === 503) {
      return new Error('Voice AI is momentarily busy. Please tap Capture Now or retry in a moment.');
    }
    if (parsed?.error?.code === 429) {
      return new Error('Voice AI rate limit reached briefly. Please try again in a few seconds.');
    }
    if (parsed?.error?.message) {
      return new Error(parsed.error.message);
    }
  } catch {
    // not JSON
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return new Error('Voice AI is momentarily busy. Please tap Capture Now or retry in a moment.');
  }
  return err instanceof Error ? err : new Error(fallback);
}

async function withGeminiRetry<T>(fn: () => Promise<T>, fallbackMsg: string): Promise<T> {
  const delays = [450, 1100];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < delays.length && isTransientError(err)) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      throw formatGeminiError(err, fallbackMsg);
    }
  }
  throw formatGeminiError(lastErr, fallbackMsg);
}

export interface ParsedExpenseResult {
  amount: number;
  description: string;
  detectedLanguage: string;
  transcript: string;
}

export async function transcribeAudioExpense(params: {
  audioBase64: string;
  mimeType: string;
  preferredLanguage?: string;
}): Promise<ParsedExpenseResult> {
  const ai = getClient();
  if (!ai) {
    throw new Error('Gemini API key is not configured on the server.');
  }

  const audioPart = {
    inlineData: {
      mimeType: params.mimeType || 'audio/webm',
      data: params.audioBase64,
    },
  };

  const transcribeResp = await withGeminiRetry(
    () =>
      ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            audioPart,
            {
              text: `Transcribe this spoken expense note accurately. The speaker may use English, Tamil, Hindi, Malayalam, Kannada, Telugu, or natural mixed-language Indian speech (Tanglish, Hinglish, Manglish, Kanglish, Tenglish). Preserve all numbers, spoken rupee amounts (like ambathu, pachas, nooru, yaabhai, fifty), and item descriptions faithfully. Speaker hint: ${params.preferredLanguage || 'Auto-detect'}.`,
            },
          ],
        },
      }),
    'Unable to transcribe voice recording right now.'
  );

  const transcript = (transcribeResp.text ?? '').trim();
  if (!transcript) {
    throw new Error('Could not hear speech clearly. Please speak a little closer and try again.');
  }

  return extractExpenseFromText({
    text: transcript,
    preferredLanguage: params.preferredLanguage,
  });
}

export async function extractExpenseFromText(params: {
  text: string;
  preferredLanguage?: string;
}): Promise<ParsedExpenseResult> {
  const ai = getClient();
  if (!ai) {
    throw new Error('Gemini API key is not configured on the server.');
  }

  const response = await withGeminiRetry(
    () =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Extract the expense amount (in Indian Rupees) and a short, clean natural expense description from this spoken or typed user phrase.
Supported languages, native scripts, and code-mixed forms:
- English: "I spent 50 rupees on burger", "coffee thirty five rupees" -> 35, "Coffee"
- Tamil / Tanglish: "Auto ku ambathu ruba kuduthen" -> 50, "Autorickshaw fare"; "Vada chai 30 ruba" -> 30, "Vada and Chai"; "நூறு ரூபாய் மளிகை" -> 100, "Groceries"
- Hindi / Hinglish: "Chai aur samosa ke liye pachas rupay kharch kiye" -> 50, "Chai and Samosa"; "मेट्रो टिकट पैंतीस रुपये" -> 35, "Metro ticket"
- Malayalam / Manglish: "Chayakku irupathu rupa" -> 20, "Chai"; "അമ്പത് രൂപ ഓട്ടോ" -> 50, "Autorickshaw fare"
- Kannada / Kanglish: "Kaapi ge aivathu rupayi" -> 50, "Coffee"; "ನೂರು ರೂಪಾಯಿ ಊಟ" -> 100, "Meal"
- Telugu / Tenglish: "Tiffin ki yaabhai rupayalu" -> 50, "Tiffin"; "వంద రూపాయలు కూరగాయలు" -> 100, "Vegetables"

Convert spoken number words in any of these 6 languages into numeric digits.
Preferred language hint: ${params.preferredLanguage || 'Auto-detect'}
Input phrase: "${params.text}"`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are a precise multilingual Indian expense parser supporting Tamil, Hindi, Malayalam, Kannada, Telugu, English, and mixed Indian speech. Always extract a positive numeric amount in INR (converting any spoken number words in those languages into digits) and a concise 1-6 word title-case description. Return amount 0 only if no amount or number is mentioned.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              amount: {
                type: Type.NUMBER,
                description: 'The numeric expense amount in rupees. 0 if not found.',
              },
              description: {
                type: Type.STRING,
                description: 'Concise expense description in 1 to 6 words.',
              },
              detectedLanguage: {
                type: Type.STRING,
                description:
                  'Detected language such as English, Tamil, Hindi, Malayalam, Kannada, Telugu, or Mixed.',
              },
            },
            required: ['amount', 'description', 'detectedLanguage'],
          },
        },
      }),
    'Unable to interpret expense phrase right now.'
  );

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as {
    amount?: number;
    description?: string;
    detectedLanguage?: string;
  };

  const amount = Number(parsed.amount ?? 0);
  const description = (parsed.description ?? '').trim() || params.text.slice(0, 60);
  const detectedLanguage = (parsed.detectedLanguage ?? params.preferredLanguage ?? 'English').trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `Heard "${params.text}", but could not find a rupee amount. Try saying the number clearly, like "50 rupees for chai".`
    );
  }

  return {
    amount: Math.round(amount * 100) / 100,
    description,
    detectedLanguage,
    transcript: params.text,
  };
}

export async function generateDailyCartoonStory(params: {
  dateKey: string;
  sceneTheme: string;
  promptSummary: string;
}): Promise<{
  title: string;
  caption: string;
  characterQuote: string;
  moneyTip: string;
} | null> {
  const ai = getClient();
  if (!ai) {
    return null;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Date: ${params.dateKey}
Scene Theme: ${params.sceneTheme}
Visual Description: ${params.promptSummary}

Write a fresh, witty, warm, and ironic daily editorial cartoon story for this Indian everyday-life illustration.`,
      config: {
        systemInstruction:
          'You write witty, affectionate, R.K. Laxman-style Indian editorial cartoon captions about everyday money moments (chai stalls, autos, street food, markets, monsoon snacks). Keep it lighthearted, creative, and strictly concise.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Short witty cartoon title (4 to 8 words).',
            },
            caption: {
              type: Type.STRING,
              description: 'Playful 1-2 sentence ironic story matching the illustration.',
            },
            characterQuote: {
              type: Type.STRING,
              description: 'Humorous 1-line quote spoken by a character in the scene.',
            },
            moneyTip: {
              type: Type.STRING,
              description: 'Friendly 1-sentence everyday rupee wisdom.',
            },
          },
          required: ['title', 'caption', 'characterQuote', 'moneyTip'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      title?: string;
      caption?: string;
      characterQuote?: string;
      moneyTip?: string;
    };

    if (parsed.title && parsed.caption && parsed.characterQuote && parsed.moneyTip) {
      return {
        title: parsed.title.trim(),
        caption: parsed.caption.trim(),
        characterQuote: parsed.characterQuote.trim(),
        moneyTip: parsed.moneyTip.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}
