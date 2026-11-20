import { GoogleGenAI } from '@google/genai';

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error('GEMINI_API_KEY is not configured. Please add it in Settings > Secrets.'),
      { statusCode: 400 }
    );
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

export function formatGeminiError(err: unknown): { status: number; message: string } {
  const anyErr = err as {
    status?: number;
    statusCode?: number;
    code?: number;
    message?: string;
  };
  const rawMessage = anyErr?.message || (err instanceof Error ? err.message : 'Gemini request failed.');
  const status = Number(anyErr?.statusCode || anyErr?.status || anyErr?.code || 500);

  if (
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('GEMINI_API_KEY')
  ) {
    return {
      status: status >= 400 && status < 600 ? status : 403,
      message: `${rawMessage} Please verify your API key in Settings > Secrets.`,
    };
  }

  if (status === 429 || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'Quota exceeded or billing-enabled API key required for this model. Select a paid API key in Settings > Secrets to raise quota.',
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: rawMessage,
  };
}
