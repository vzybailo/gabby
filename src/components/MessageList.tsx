import type { ChatMessage } from '../types/chat';
import Message from './Message';

interface MessageListProps {
  messages: ChatMessage[];
}

export default function MessageList({ messages }: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
      {messages.map(msg => (
        <Message key={msg.id} msg={msg} />
      ))}
    </div>
  );
}
