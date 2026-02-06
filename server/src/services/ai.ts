import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { systemPrompt } from '../prompts/systemPrompt';

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AUDIO_DIR = path.resolve('./audio');

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);


export async function assessLevel(text: string): Promise<AssessmentResult> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt + '\n\nTASK: Just assess the level (A1-C2) and write a short welcome reply. JSON: { "level": "...", "reply": "..." }' },
          { role: 'user', content: text }
        ],
        temperature: 0.4, 
        response_format: { type: "json_object" }
      }),
    });

    const data = await response.json();
    const parsedContent = JSON.parse(data.choices[0].message.content);
    
    return {
        level: parsedContent.level || 'A1',
        reply: parsedContent.reply || 'Welcome!'
    };

  } catch (e) {
    console.error('Assessment Error:', e);
    return { level: 'B1', reply: 'Could not analyze text perfectly, let\'s start with B1.' };
  }
}

export async function getAIResponse(messages: ChatMessage[], level: string = 'B1'): Promise<AIResponse> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');

  const validMessages = messages
    .filter(m => typeof m.content === 'string' && m.content.trim() !== '')
    .map(m => ({ role: m.role, content: m.content }));

  const levelInstruction = `User's English Level: ${level}. Adjust your vocabulary in "reply" to match ${level}, but keep the American "vibe".`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: `${systemPrompt}\n\n${levelInstruction}` }, ...validMessages],
        temperature: 0.8,     
        response_format: { type: "json_object" }
      }),
    });

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    return {
      corrected: parsed.corrected || '',
      is_correct: parsed.is_correct ?? true,
      reply: parsed.reply || "I'm interesting in hearing more!",
      user_errors: parsed.user_errors || [],
      better_alternatives: parsed.better_alternatives || []
    };

  } catch (e) {
    console.error('AI REQUEST FAILED:', e);
    return { 
        reply: 'Sorry, I am having trouble connecting right now.', 
        corrected: '', 
        is_correct: true,
        user_errors: [],
        better_alternatives: []
    };
  }
}

export async function generateSpeech(text: string): Promise<{ audioUrl: string }> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');

  const fileName = `${randomUUID()}.ogg`;
  const filePath = path.join(AUDIO_DIR, fileName);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
        response_format: 'opus',
      }),
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return { audioUrl: `/audio/${fileName}` };
  } catch (err) {
    console.error('TTS FAILED:', err);
    throw err;
  }
}