import OpenAI from 'openai';

// Функции, которые раньше бот вызывал сам у себя по HTTP (/api/transcribe, /api/translate, /api/assess-level).
// Теперь бот вызывает их напрямую, а HTTP-эндпоинты закрыты авторизацией.

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Подсказка-пример с ошибками и запинками: Whisper подстраивается под стиль подсказки
// и записывает речь дословно, не «исправляя» грамматику ученика (иначе бот не увидит ошибок).
const VERBATIM_PROMPT = "Um, so, yesterday I go to the shop and, uh, I buyed some apple. She don't like it, you know.";

function looksLikePromptEcho(text: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    const t = norm(text);
    return t.length >= 15 && norm(VERBATIM_PROMPT).includes(t);
}

export async function transcribeAudio(buffer: Buffer): Promise<string> {
    const audioFile = await OpenAI.toFile(buffer, 'voice.ogg', { type: 'audio/ogg' });
    const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        prompt: VERBATIM_PROMPT
    });
    // На тишине Whisper иногда возвращает текст подсказки — считаем это пустой записью
    return looksLikePromptEcho(transcription.text) ? '' : transcription.text;
}

export async function translateText(text: string, targetLang = 'Russian'): Promise<string> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: `You are a translator. Translate the following text to ${targetLang}. Keep the tone conversational.` },
            { role: 'user', content: text }
        ]
    });
    return completion.choices[0]?.message?.content || 'Translation error';
}

export async function assessLevelText(text: string): Promise<{ level?: string; reply?: string }> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'system',
                content: "You are an English language expert. Analyze the user's English level (A1, A2, B1, B2, C1, C2) based on the provided text. Return ONLY a JSON object with two fields: 'level' (the grade) and 'reply' (a very short encouraging comment in Russian about their level)."
            },
            { role: 'user', content: `Assess my level based on this: "${text}"` }
        ],
        response_format: { type: 'json_object' }
    });
    return JSON.parse(completion.choices[0]?.message?.content || '{}');
}

export async function generateTopic(): Promise<string> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: 'Give me a short, engaging conversation topic for an English learner. Just the topic/question.' }]
    });
    return completion.choices[0]?.message.content || 'No topic generated';
}

export type ErrorDigestItem = { pattern: string; explanation: string; example_wrong: string; example_right: string; practice: string };

/** Группирует ошибки пользователя за неделю в 2–3 повторяющихся шаблона. */
export async function buildErrorDigest(errors: { error_part: string; correction: string; explanation?: string }[]): Promise<ErrorDigestItem[]> {
    const list = errors
        .slice(0, 80)
        .map(e => `- "${e.error_part}" → "${e.correction}"${e.explanation ? ` (${e.explanation})` : ''}`)
        .join('\n');

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: `You are an English tutor for Russian speakers. You get a list of a student's grammar mistakes from the last week.
Group them into the 2-3 most frequent RECURRING patterns (ignore one-off typos).
Return JSON: {"items":[{"pattern":"short name in Russian","explanation":"1-2 sentences in Russian","example_wrong":"one of the student's real mistakes","example_right":"its correction","practice":"one short practice task in Russian: ask the student to write 1-2 English sentences using the correct form"}]}.
If there are no recurring patterns, return {"items":[]}.`
            },
            { role: 'user', content: list }
        ]
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return Array.isArray(parsed.items) ? parsed.items.slice(0, 3) : [];
}

/** Ученик написал/сказал по-русски: подсказываем, как это сказать по-английски на его уровне. */
export async function helpSayInEnglish(text: string, level: string): Promise<{ english: string; note: string }> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: `You help a Russian-speaking English learner (level ${level}) who wrote a message partly or fully in Russian because they did not know how to say it.
Return JSON: {"english": "how to say the whole message naturally in English, using words suitable for level ${level}", "note": "one short tip in Russian about a key word or construction (or empty string)"}.`
            },
            { role: 'user', content: text.slice(0, 1000) }
        ]
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return { english: String(parsed.english || '').trim(), note: String(parsed.note || '').trim() };
}
