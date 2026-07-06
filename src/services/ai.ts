import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { systemPrompt } from '../prompts/systemPrompt.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUDIO_DIR = path.resolve('./audio');

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export interface UserSettings {      
  level: string;       
  voice: string;         
  speakingStyle: string;  
}

export interface AIResponse {
  corrected: string;    
  is_correct: boolean;  
  level?: string;  
  reply: string;      
  user_errors: Array<{ 
    error_part: string; 
    correction: string; 
    explanation: string; 
  }>;
  better_alternatives: string[];
  grammarScore: number; 
}

export type AssessmentResult = {
  level: string;
  reply: string; 
};

export async function assessLevel(text: string): Promise<AssessmentResult> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt + '\n\nTASK: Assess CEFR level (A1-C2) and write a short welcome reply.' },
        { role: 'user', content: text }
      ],
      temperature: 0.4, 
      response_format: { type: "json_object" }
    });
    const parsed = JSON.parse(completion.choices[0]?.message.content || "{}");
    return { level: parsed.level || 'A1', reply: parsed.reply || 'Welcome!' };
  } catch (e) {
    return { level: 'A1', reply: 'Welcome! Let\'s start.' };
  }
}

export async function getChatResponse(
    messages: ChatMessage[], 
    settings: UserSettings 
): Promise<AIResponse> {

  const LENIENCY_RULE = `
    IMPORTANT CORRECTION RULES:
    1. IGNORE capitalization errors (e.g., "i go" is fine).
    2. IGNORE missing punctuation.
    3. SYNC RULE (CRITICAL): If you add ANY error to 'user_errors', you ABSOLUTELY MUST apply that exact fix in the 'corrected' string! The 'corrected' text must reflect all fixes.
    4. If there are no real errors, "user_errors" MUST be empty [] and "corrected" MUST exactly match the user's input.
  `;

  const SCORING_RULE = `
    SCORING TASK (0-100):
    Rate the user's latest message grammar accuracy.
    - 100: Perfect grammar and natural phrasing (or only capitalization/punctuation issues).
    - 90-99: 1 minor typo or awkward phrasing.
    - 75-89: Understandable but has 1-2 clear grammar mistakes (tenses, articles).
    - 50-74: Multiple errors, hard to read, or broken English.
    - 0-49: Nonsense or wrong language.
    RETURN this as integer 'grammarScore'.
  `;

  const dialectInstruction = (settings.voice === 'fable')
      ? "ACCENT: BRITISH ENGLISH. Use spelling like 'colour', 'favourite'. Use terms like 'lift', 'flat', 'cheers'." 
      : "ACCENT: AMERICAN ENGLISH. Use standard US spelling and vocabulary.";

  let styleInstruction = "Speak normally.";
  switch (settings.speakingStyle) {
      case 'teacher': 
          styleInstruction = "STYLE: PATIENT ESL TEACHER. Speak slowly and clearly. Tone: Warm, encouraging.";
          break;
      case 'standard': 
          styleInstruction = "STYLE: STANDARD ENGLISH. Crisp, clear, professional. No slang.";
          break;
      case 'friend': 
          styleInstruction = "STYLE: CASUAL FRIEND. REACT FIRST! Tone: Interested, supportive, casual.";
          break;
      case 'street': 
          styleInstruction = "STYLE: STREET SLANG / NATIVE. Use aggressive contractions: 'gonna', 'wanna'.";
          break;
  }

  const modeInstruction = `
    MODE: CHILL CHAT.
    1. Focus on the conversation flow. 
    2. Only correct MAJOR mistakes that confuse the meaning. Ignore missing commas or minor typos.
    3. Be supportive and conversational.
  `;
  const correctionStrictness = `Correct only critical errors. ${LENIENCY_RULE}`;
  const temp = 0.75;

  let levelInstruction = `USER LEVEL: ${settings.level}.`;
  if (['A1', 'A2'].includes(settings.level)) {
      levelInstruction += " Use VERY SIMPLE, basic vocabulary. NO idioms, NO complex phrasal verbs, NO slang.";
  } else if (settings.level === 'B1') {
      levelInstruction += " Use everyday vocabulary. Introduce common, simple phrasal verbs.";
  } else if (settings.level === 'B2') {
      levelInstruction += " Speak naturally with common idioms.";
  } else if (['C1', 'C2'].includes(settings.level)) {
      levelInstruction += " Use sophisticated, native-level vocabulary, idioms, and slang.";
  }

  const fullSystemPrompt = `${systemPrompt}
  
  --- CURRENT SETTINGS ---
  ${levelInstruction}
  ${dialectInstruction}
  ${styleInstruction}
  
  ${modeInstruction}
  MANDATORY: Always provide 2-3 "better_alternatives" even if the user is correct. 
  Ensure these alternatives perfectly match the user's ${settings.level} English level.
  
  Correction Policy: ${correctionStrictness}
  
  CRITICAL JSON RULE: 
  If "user_errors" is NOT empty, the "corrected" string MUST BE DIFFERENT from the input and reflect those fixes!
  
  ${SCORING_RULE}
  
  IMPORTANT: Return valid JSON with keys: 
  {
    "reply": "string",
    "corrected": "string",
    "is_correct": boolean,
    "user_errors": [],
    "better_alternatives": [],
    "grammarScore": number
  }`;

  const validMessages = messages
    .filter(m => typeof m.content === 'string' && m.content.trim() !== '')
    .map(m => ({ role: m.role, content: m.content }));

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: fullSystemPrompt }, ...validMessages],
      temperature: temp, 
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(completion.choices[0]?.message.content || "{}");

    let calculatedScore = parsed.grammarScore;
    if (typeof calculatedScore !== 'number') {
        const errorCount = (parsed.user_errors || []).length;
        calculatedScore = parsed.is_correct ? 100 : Math.max(0, 100 - (errorCount * 15));
    }

    return {
      corrected: parsed.corrected || '',
      is_correct: parsed.is_correct ?? true,
      reply: parsed.reply || "Thinking...",
      user_errors: parsed.user_errors || [],
      better_alternatives: parsed.better_alternatives || [],
      grammarScore: calculatedScore
    };

  } catch (e) {
    console.error('AI ERROR:', e);
    return { 
        reply: 'Wait... connection glitch.', 
        corrected: '', is_correct: true, user_errors: [], better_alternatives: [],
        grammarScore: 100 
    };
  }
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
      input: text,
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