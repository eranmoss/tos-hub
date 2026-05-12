import { useState } from 'react';
import { marked } from 'marked';

const fmtTime = (ts) => {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

export default function AgentMessage({ message, onSaveFavourite }) {
  const [saving, setSaving] = useState(false);
  const isUser = message.role === 'user';

  const bubbleCls = isUser
    ? 'self-end bg-accent text-white'
    : 'self-start bg-white text-text-primary border border-border-default';

  const handleSave = async () => {
    const label = window.prompt('Name this prompt:');
    if (!label?.trim()) return;
    try {
      setSaving(true);
      await onSaveFavourite(label.trim(), message.triggering_user_text || '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex flex-col max-w-[90%] ${isUser ? 'items-end self-end' : 'items-start self-start'} mb-3`}>
      <div className={`rounded-bubble px-4 py-2 text-sm shadow-sm ${bubbleCls}`}>
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: marked.parse(message.content || '') }}
          />
        )}
      </div>
      <div className="text-[10px] text-text-secondary mt-1 flex items-center gap-2">
        <span>{isUser ? 'You' : 'Agent'} · {fmtTime(message.ts)}</span>
        {!isUser && message.triggering_user_text && (
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="text-accent hover:underline"
          >
            ★ Save this prompt
          </button>
        )}
      </div>
    </div>
  );
}
