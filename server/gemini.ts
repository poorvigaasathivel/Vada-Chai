import { GoogleGenAI, Type } from '@google/genai';

function getClient(): GoogleGenAI | null {
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

  const transcribeResp = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        audioPart,
        {
          text: `Transcribe this spoken expense note accurately. The speaker may use English, Tamil, Hindi, Malayalam, Kannada, Telugu, or natural mixed-language Indian speech (such as Tanglish, Hinglish, Manglish, Kanglish, or Tenglish). Preserve numbers and item words clearly. Speaker hint: ${params.preferredLanguage || 'Auto-detect'}.`,
        },
      ],
    },
  });

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

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Extract the expense amount (in Indian Rupees) and a short, clean English/natural expense description from this spoken or typed user phrase.
Supported languages & code-mixed forms: Tamil, Hindi, Malayalam, Kannada, Telugu, English (including Tanglish, Hinglish, Manglish, Kanglish, Tenglish).
Examples:
- "I spent 50 rupees on burger" -> amount: 50, description: "Burger", detectedLanguage: "English"
- "Auto ku 80 ruba kuduthen" -> amount: 80, description: "Autorickshaw fare", detectedLanguage: "Tamil (Mixed)"
- "Chai aur samosa ke liye 45 rupay kharch kiye" -> amount: 45, description: "Chai and Samosa", detectedLanguage: "Hindi"
- "Metro ticket fifty five rupees" -> amount: 55, description: "Metro ticket", detectedLanguage: "English"

Preferred language hint: ${params.preferredLanguage || 'Auto-detect'}
Input phrase: "${params.text}"`,
    config: {
      systemInstruction:
        'You are a precise multilingual Indian expense parser. Always extract a positive numeric amount in INR and a concise 1-5 word title-case description. Never invent an amount if none is spoken (return 0 if missing).',
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
  });

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
