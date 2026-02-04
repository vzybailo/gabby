import type { ApiChatMessage } from '../types/chat';

const BACKEND_URL = process.env.SERVER_URL || ''; 

export async function sendChat(messages: ApiChatMessage[]) {
  if (!BACKEND_URL) {
    throw new Error('BACKEND_URL environment variable is not set');
  }
  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  return res.json();
}
