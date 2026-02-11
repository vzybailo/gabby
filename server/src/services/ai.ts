import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { systemPrompt } from '../prompts/systemPrompt';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUDIO_DIR = path.resolve('./audio');

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

// --- ТИПЫ ---

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export interface UserSettings {
  mode: string;        
  level: string;       
  voice: string;          // Тембр (Alloy, Echo...)
  speakingStyle: string;  // Стиль (Teacher, Street...)
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
}

export type AssessmentResult = {
  level: string;
  reply: string; 
};

// --- ФУНКЦИИ ---

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

// 🔥 ГЛАВНАЯ ФУНКЦИЯ ГЕНЕРАЦИИ ТЕКСТА
export async function getChatResponse(
    messages: ChatMessage[], 
    settings: UserSettings 
): Promise<AIResponse> {

  let styleInstruction = "Speak normally.";
  
  // 🔥 ТЕХНИКА: PUNCTUATION HACKING
  // Мы заставляем AI писать текст так, чтобы TTS читал его с нужной интонацией.
  
  switch (settings.speakingStyle) {
      case 'teacher': 
          styleInstruction = `
            STYLE: PATIENT ESL TEACHER. 
            - Speak slowly and clearly.
            - Use pauses (...) to let information sink in.
            - Example: "That was good... however... try this word."
            - Avoid contractions (say "I am" not "I'm").
            - Tone: Warm, encouraging, very articulate.
          `;
          break;

      case 'standard': 
          styleInstruction = `
            STYLE: STANDARD ENGLISH / NEWS ANCHOR. 
            - Crisp, clear, professional.
            - No slang. Standard grammar.
            - Use standard punctuation.
          `;
          break;

      case 'friend': 
          styleInstruction = `
            STYLE: BEST FRIEND / CASUAL. 
            - REACT FIRST! If user says something sad, say "Oh no...". If happy, say "That's awesome!".
            - Use fillers sparingly: "Well...", "You know...".
            - Use exclamation marks (!) for excitement.
            - Tone: Interested, supportive, casual.
          `;
          break;

      case 'street': 
          styleInstruction = `
            STYLE: NATIVE FAST SPEAKER (Street/Slang). 
            - IMPERFECTION IS KEY. DO NOT SOUND LIKE A ROBOT.
            - Use aggressive contractions: "gonna" (going to), "wanna" (want to), "dunno" (don't know), "gotta".
            - Use fillers to sound natural: "Like...", "Uh...", "I mean...".
            - Start sentences with "Man,", "So, uh,", "Listen,".
            - Use "..." for thinking pauses.
            - Example: "Man, I dunno... that sounds kinda crazy, right?"
          `;
          break;
      
      default:
          styleInstruction = "Speak normally.";
  }

  let modeInstruction = "";
  if (settings.mode === 'grammar') {
      modeInstruction = `MODE: GRAMMAR NAZI. Correct EVERY mistake strictly.`;
  } else if (settings.mode === 'roleplay') {
      modeInstruction = `MODE: ROLEPLAY. Stay in character. Keep replies conversational.`;
  } else {
      modeInstruction = `MODE: CHILL CHAT. Only correct mistakes that destroy meaning.`;
  }

  const fullSystemPrompt = `${systemPrompt}
  
  --- CURRENT SETTINGS ---
  User Level: ${settings.level}
  ${styleInstruction}
  ${modeInstruction}
  
  IMPORTANT: Return JSON response. The 'reply' field must match the STYLE instructions exactly (include the slang/pauses).`;

  const validMessages = messages
    .filter(m => typeof m.content === 'string' && m.content.trim() !== '')
    .map(m => ({ role: m.role, content: m.content }));

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: fullSystemPrompt }, ...validMessages],
      temperature: 0.85, // Чуть выше для креативности и живости
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(completion.choices[0]?.message.content || "{}");

    return {
      corrected: parsed.corrected || '',
      is_correct: parsed.is_correct ?? true,
      reply: parsed.reply || "Thinking...",
      user_errors: parsed.user_errors || [],
      better_alternatives: parsed.better_alternatives || []
    };

  } catch (e) {
    console.error('AI ERROR:', e);
    return { 
        reply: 'Wait... connection glitch.', 
        corrected: '', is_correct: true, user_errors: [], better_alternatives: [] 
    };
  }
}

// 🔥 ГЕНЕРАЦИЯ РЕЧИ (ПРИНИМАЕТ ГОЛОС И СТИЛЬ)
export async function generateSpeech(text: string, voice: string, style: string = 'standard'): Promise<{ audioUrl: string }> {
  const fileName = `${randomUUID()}.mp3`;
  const filePath = path.join(AUDIO_DIR, fileName);

  // 1. Карта скоростей (зависит от стиля)
  const speedMap: Record<string, number> = {
    'teacher': 0.9,   // Чуть медленнее
    'standard': 1.0,  // Норма
    'friend': 1.05,   // Живо
    'street': 1.15    // Быстро, но читаемость сохраняется за счет сленга в тексте
  };

  const speed = speedMap[style] || 1.0;

  // 2. Валидация голоса (OpenAI voices)
  const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  const selectedVoice = validVoices.includes(voice) ? voice : 'alloy';

  try {
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1', // tts-1 звучит более "живо" и "грязно", чем tts-1-hd
      voice: selectedVoice as any,
      input: text,
      speed: speed,
      response_format: 'mp3',
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return { audioUrl: `/audio/${fileName}` };
  } catch (err) {
    console.error('TTS FAILED:', err);
    throw err;
  }
}