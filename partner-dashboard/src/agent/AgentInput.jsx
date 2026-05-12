import { useState, useEffect, useRef } from 'react';
import SavedPromptChip from './SavedPromptChip.jsx';

export default function AgentInput({
  savedPrompts, onSend, onNewConversation, onDeletePrompt, isLoading, autoFocus,
}) {
  const [text, setText] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim() || isLoading) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div className="border-t border-border-default p-3 bg-white">
      <div className="flex flex-wrap items-center mb-2 max-h-16 overflow-y-auto">
        {savedPrompts.length === 0 ? (
          <span className="text-xs text-text-secondary">Save Favourites ★</span>
        ) : (
          savedPrompts.map((p) => (
            <SavedPromptChip
              key={p.id}
              prompt={p}
              onClick={(pp) => setText(pp.prompt_text)}
              onDelete={onDeletePrompt}
            />
          ))
        )}
      </div>
      <form onSubmit={submit} className="flex gap-2 items-end">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
          rows={2}
          placeholder="Ask anything about your integration…"
          className="flex-1 rounded-btn border border-border-default px-3 py-2 resize-none text-sm focus:border-accent focus:outline-none"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!text.trim() || isLoading}
          className="rounded-btn bg-accent text-white font-medium px-4 py-2 text-sm disabled:opacity-50"
        >
          Send ▶
        </button>
      </form>
      <div className="mt-2 text-xs">
        <button type="button" onClick={onNewConversation} className="text-accent hover:underline">
          New conversation
        </button>
      </div>
    </div>
  );
}
