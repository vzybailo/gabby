import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types/chat';
import type { ApiChatMessage } from '../types/chat';
import { sendChat } from '../../server/src/services/api';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import VoiceInput from './VoiceInput';

const API_URL = import.meta.env.API_URL;

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(text: string) {
    if (!text.trim()) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const messagesToSend: ApiChatMessage[] = nextMessages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const data = await sendChat(messagesToSend);

      const aiMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message.content,
        feedback: data.message.feedback,
      };

      setMessages(prev => [...prev, aiMessage]);

      if (data.audioUrl) {
        const audio = new Audio(`${API_URL}${data.audioUrl}`);
        audio.play().catch(err => console.error('Audio play failed:', err));
      }

    } catch (err) {
      console.error('Chat handleSend error:', err);
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '⚠️ Something went wrong. Try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto border shadow-md">
      <MessageList messages={messages} />

      <div ref={messagesEndRef} />

      <div className="flex gap-2 p-4 border-t bg-white">
        <div className="flex-1">
          <ChatInput onSend={handleSend} loading={loading} />
        </div>

        <VoiceInput onSend={handleSend} loading={loading} />
      </div>
    </div>
  );
}
