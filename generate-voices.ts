import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const text = "Hello! I am your AI English tutor. I will help you speak fluently.";

async function main() {
  const audioDir = path.resolve('audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

  console.log('🎙 Generating voice previews...');

  for (const voice of voices) {
    console.log(`   Processing ${voice}...`);
    try {
      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: voice as any,
        input: text,
      });
      
      const buffer = Buffer.from(await mp3.arrayBuffer());
      fs.writeFileSync(path.join(audioDir, `${voice}.mp3`), buffer);
    } catch (e) {
      console.error(`❌ Error with ${voice}:`, e);
    }
  }
  console.log('✅ All voices generated in /audio folder!');
}

main();