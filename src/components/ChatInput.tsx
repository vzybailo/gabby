import { useState } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  loading: boolean;
}

export default function ChatInput({ onSend, loading }: ChatInputProps) {
  const [value, setValue] = useState('');

  function handleSend() {
    if (!value.trim() || loading) return;

    onSend(value.trim());
    setValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="border-t p-4 bg-white">
      <div className="flex gap-2 items-end">
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Type your message in English..."
          disabled={loading}
          className="
            flex-1 resize-none rounded-lg border
            px-3 py-2 text-sm
            focus:outline-none focus:ring-2 focus:ring-blue-500
            disabled:bg-gray-100
          "
        />

        <button
          onClick={handleSend}
          disabled={loading || !value.trim()}
          className="
            bg-blue-600 text-white
            px-4 py-2 rounded-lg text-sm
            hover:bg-blue-700
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          Send
        </button>
      </div>
    </div>
  );
}
