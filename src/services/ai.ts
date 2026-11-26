import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { buildTutorPrompt } from '../prompts/systemPrompt.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUDIO_DIR = path.resolve('./audio');

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Ниже, чем было (0.75): исправления должны быть стабильными, а разговор остаётся живым
const CHAT_TEMPERATURE = 0.5;

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export interface UserSettings {
  level: string;
  voice: string;
  speakingStyle: string;
  learnerProfile?: string | null | undefined;
}

export interface AIResponse {
  corrected: string;
  is_correct: boolean;
  reply: string;
  user_errors: Array<{
    error_part: string;
    correction: string;
    explanation: string;
  }>;
  better_alternatives: string[];
  praise: string;
  grammarScore: number;
  new_vocabulary: NewVocabItem[];
}

export type NewVocabItem = {
  word: string;
  translation: string;
  definition: string;
  example: string;
};

export async function getChatResponse(
    messages: ChatMessage[],
    settings: UserSettings,
    vocabulary: {
        word: string;
        translation: string;
        repetition: number;
    }[] = []
): Promise<AIResponse> {
  const systemPrompt = buildTutorPrompt({
    level: settings.level,
    voice: settings.voice,
    speakingStyle: settings.speakingStyle,
    vocabulary,
    learnerProfile: settings.learnerProfile
  });

  const validMessages = messages
    .filter(m => typeof m.content === 'string' && m.content.trim() !== '')
    .map(m => ({ role: m.role, content: m.content }));

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, ...validMessages],
      temperature: CHAT_TEMPERATURE,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(completion.choices[0]?.message.content || "{}");
    const userErrors = Array.isArray(parsed.user_errors)
      ? parsed.user_errors.filter((e: any) => e && e.error_part && e.correction).slice(0, 3)
      : [];

    let calculatedScore = parsed.grammarScore;
    if (typeof calculatedScore !== 'number') {
        calculatedScore = userErrors.length === 0 ? 100 : Math.max(0, 100 - (userErrors.length * 15));
    }

    return {
      corrected: parsed.corrected || '',
      is_correct: userErrors.length === 0,
      reply: parsed.reply || "Thinking...",
      user_errors: userErrors,
      better_alternatives: Array.isArray(parsed.better_alternatives) ? parsed.better_alternatives.slice(0, 3) : [],
      praise: typeof parsed.praise === 'string' ? parsed.praise.trim() : '',
      grammarScore: calculatedScore,
      new_vocabulary: Array.isArray(parsed.new_vocabulary)
        ? parsed.new_vocabulary
            .filter((v: any) => v && typeof v.word === 'string' && v.word.trim() && v.word.length <= 60)
            .slice(0, 2)
        : []
    };

  } catch (e) {
    console.error('AI ERROR:', e);
    return {
        reply: 'Wait... connection glitch.',
        corrected: '', is_correct: true, user_errors: [], better_alternatives: [], praise: '',
        grammarScore: 100, new_vocabulary: []
    };
  }
}

/** Убирает эмодзи и разметку, чтобы TTS не спотыкался. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function generateSpeech(text: string, voice: string, style: string = 'standard'): Promise<{ audioBuffer?: Buffer }> {
  const speedMap: Record<string, number> = {
    'teacher': 0.9,   
    'standard': 1.0,  
    'friend': 1.05,   
    'street': 1.15    
  };

  const speed = speedMap[style] || 1.0;
  const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  const selectedVoice = validVoices.includes(voice) ? voice : 'alloy';

  try {
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: selectedVoice as any,
      input: cleanForSpeech(text),
      speed: speed,
      response_format: 'mp3',
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    
    return { audioBuffer: buffer }; 
  } catch (err) {
    console.error('TTS FAILED:', err);
    throw err; 
  }
}