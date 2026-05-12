import { useEffect, useRef } from 'react';
import AgentInput from './AgentInput.jsx';
import AgentMessage from './AgentMessage.jsx';
import { useAgent } from './useAgent.js';
import { usePageContext } from './usePageContext.js';

const SUGGESTED = [
  "What's my error rate today?",
  'Show me recent duplicate detections',
  'Are all my integrations healthy?',
  'What caused my last escalation?',
];

export default function AgentPanel({ open, onUnreadChange }) {
  const {
    messages, isLoading, error,
    savedPrompts, sendMessage, startNewConversation,
    saveFavourite, deleteFavourite,
  } = useAgent();
  const { ctx } = usePageContext();
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    // Mark unread if panel is closed when a new assistant message arrives
    if (!open && messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      onUnreadChange?.(true);
    }
  }, [messages, open, onUnreadChange]);

  useEffect(() => {
    if (open) onUnreadChange?.(false);
  }, [open, onUnreadChange]);

  const doSend = (text) => sendMessage(text, ctx);
  const sendSuggested = (text) => sendMessage(text, ctx);

  return (
    <aside
      className={`bg-agent-bg border-l border-border-default shadow-md flex flex-col h-full transition-all duration-200 ${open ? 'w-[360px]' : 'w-0 overflow-hidden'}`}
      aria-hidden={!open}
      data-testid="agent-panel"
    >
      <div className="flex items-center justify-between p-3 border-b border-border-default bg-white">
        <h2 className="font-semibold text-primary">TOS Agent</h2>
        <button
          type="button"
          onClick={startNewConversation}
          className="text-xs text-accent hover:underline"
        >
          + New conversation
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col">
        {messages.length === 0 && (
          <div className="text-sm text-text-secondary">
            <p className="mb-2">Suggested questions:</p>
            <div className="grid gap-2">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendSuggested(q)}
                  className="text-left text-xs rounded-btn border border-border-default bg-white px-3 py-2 hover:border-accent"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <AgentMessage key={m.id || i} message={m} onSaveFavourite={saveFavourite} />
        ))}

        {isLoading && (
          <div className="self-start text-text-secondary text-sm">
            <span className="inline-block animate-pulse">● ● ●</span>
          </div>
        )}
        {error && (
          <div className="self-start text-danger text-xs">{error}</div>
        )}
      </div>

      <AgentInput
        savedPrompts={savedPrompts}
        onSend={doSend}
        onNewConversation={startNewConversation}
        onDeletePrompt={deleteFavourite}
        isLoading={isLoading}
        autoFocus={open}
      />
    </aside>
  );
}
