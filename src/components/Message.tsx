import type { ChatMessage } from '../types/chat';

export default function Message({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'assistant') {
    return (
      <div className="p-3 bg-gray-100 rounded-lg space-y-3">
        <p>{msg.content}</p>

        {msg.feedback?.mistakes?.length! > 0 && (
          <div className="space-y-2">
            {msg.feedback?.mistakes?.map((m, i) => (
              <div
                key={i}
                className="border-l-4 border-red-400 pl-3 text-sm"
              >
                <div className="text-red-600 line-through">
                  ❌ {m.wrong}
                </div>
                <div className="text-green-600">
                  ✅ {m.correct}
                </div>
                <div className="text-gray-600">
                  💡 {m.explanation}
                </div>
              </div>
            ))}
          </div>
        )}

        {msg.feedback?.natural && (
          <div className="text-sm text-blue-600">
            💬 <b>Natural version:</b> {msg.feedback.natural}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 bg-blue-100 rounded-lg self-end">
      {msg.content}
    </div>
  );
}
