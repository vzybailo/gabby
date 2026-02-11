import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { systemPrompt } from '../prompts/systemPrompt.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUDIO_DIR = path.resolve('./audio');

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export interface UserSettings {
  mode: string;        
  level: string;       
  voice: string;         
  speakingStyle: string;  
  interviewContext?: string | null; 
  roleplayContext?: string | null; 
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
    IMPORTANT CORRECTION RULE:
    - IGNORE capitalization errors (e.g., "i go" is fine, treat as "I go").
    - IGNORE missing punctuation (e.g., no period at the end is fine).
    - Mark 'is_correct' as TRUE if the only mistakes are casing or punctuation.
    - ONLY report errors for Grammar (tense, conjugation), Vocabulary, or Word Order.
  `;

  const dialectInstruction = (settings.voice === 'fable')
      ? "ACCENT: BRITISH ENGLISH. Use spelling like 'colour', 'favourite'. Use terms like 'lift', 'flat', 'cheers'." 
      : "ACCENT: AMERICAN ENGLISH. Use standard US spelling and vocabulary.";

  let styleInstruction = "Speak normally.";
  
  switch (settings.speakingStyle) {
      case 'teacher': 
          styleInstruction = `
            STYLE: PATIENT ESL TEACHER. 
            - Speak slowly and clearly.
            - Use pauses (...) to let information sink in.
            - Avoid contractions (say "I am" not "I'm").
            - Tone: Warm, encouraging.
          `;
          break;

      case 'standard': 
          styleInstruction = `
            STYLE: STANDARD ENGLISH. 
            - Crisp, clear, professional.
            - No slang. Standard grammar.
          `;
          break;

      case 'friend': 
          styleInstruction = `
            STYLE: CASUAL FRIEND. 
            - REACT FIRST! (e.g., "Oh no...", "Wow!").
            - Use fillers sparingly: "Well...", "You know...".
            - Tone: Interested, supportive, casual.
          `;
          break;

      case 'street': 
          styleInstruction = `
            STYLE: STREET SLANG / NATIVE. 
            - Use aggressive contractions: "gonna", "wanna", "dunno".
            - Use fillers: "Like...", "Uh...", "I mean...".
            - Start sentences with "Man,", "So, uh,".
            - Example: "Man, I dunno... that sounds kinda crazy."
          `;
          break;
  }

  let modeInstruction = "";
  let correctionStrictness = "";
  let temp = 0.7;

  if (settings.mode === 'interview') {
      const targetJob = settings.interviewContext || "a general professional position";
      modeInstruction = `
        MODE: JOB INTERVIEW SIMULATION.
        CONTEXT: You are a professional HR Recruiter interviewing the user for the position of: "${targetJob}".
        
        RULES:
        1. Ask ONE question at a time.
        2. Give SHORT feedback (1 sentence) on their answer, then ask the NEXT question.
        3. Keep a professional tone.
        
        IMPORTANT - ENDING THE SESSION:
        If the user says "Stop", "Goodbye", "That's all", or if you have asked 5-7 questions and feel the interview is done:
        - Do NOT ask another question.
        - Conclude the interview professionally.
        - EXPLICITLY say: "Interview finished! 🏁 To go back to normal chat, please open Settings and select 'Just Chat' mode."
      `;
      correctionStrictness = `Correct only major grammar mistakes that affect professionalism. ${LENIENCY_RULE}`;
      temp = 0.6;

  } else if (settings.mode === 'roleplay') {
      const scenario = settings.roleplayContext || "Casual conversation with a stranger";
      
      modeInstruction = `
        MODE: ROLEPLAY SIMULATION.
        SCENARIO: ${scenario}
        
        RULES:
        1. You are a character in this scenario. DO NOT say you are an AI.
        2. Keep replies SHORT and NATURAL (under 20 words). Real people don't write essays.
        3. IGNORE grammar mistakes unless the meaning is lost.
        4. Focus on moving the action forward (e.g., "Anything else?", "Cash or card?").
      `;

      correctionStrictness = `Ignore mistakes. Focus on the scene. ${LENIENCY_RULE}`;
      temp = 0.9;

  } else if (settings.mode === 'grammar') {
      modeInstruction = `MODE: GRAMMAR TEACHER (STRICT). Correct EVERY mistake including punctuation.`;
      correctionStrictness = "STRICT: Mark 'is_correct' as FALSE for any tiny mistake.";
      temp = 0.5;

  } else {
      modeInstruction = `
        MODE: CHILL CHAT.
        1. Focus on the conversation flow. 
        2. Only correct MAJOR mistakes that confuse the meaning. Ignore missing commas or minor typos.
        3. Be supportive and conversational.
      `;

      correctionStrictness = `Correct only critical errors. ${LENIENCY_RULE}`;
      temp = 0.75;
  }

  const fullSystemPrompt = `${systemPrompt}
  
  --- CURRENT SETTINGS ---
  User Level: ${settings.level}
  ${dialectInstruction}
  ${styleInstruction}
  
  ${modeInstruction}
  Correction Policy: ${correctionStrictness}
  
  IMPORTANT: Return JSON response. The 'reply' field must match the STYLE instructions exactly.`;

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

export async function generateSpeech(text: string, voice: string, style: string = 'standard'): Promise<{ audioUrl: string }> {
  const fileName = `${randomUUID()}.mp3`;
  const filePath = path.join(AUDIO_DIR, fileName);

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
    fs.writeFileSync(filePath, buffer);

    return { audioUrl: `/audio/${fileName}` };
  } catch (err) {
    console.error('TTS FAILED:', err);
    throw err;
  }
}