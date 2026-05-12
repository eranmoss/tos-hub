import { useState } from 'react';

export default function SavedPromptChip({ prompt, onClick, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border-default bg-white px-3 py-1 text-xs font-medium mr-2 mb-2">
      <button
        type="button"
        onClick={() => onClick(prompt)}
        className="text-text-primary hover:text-accent"
        title={prompt.prompt_text}
      >
        ★ {prompt.label}
      </button>
      {confirm ? (
        <button
          type="button"
          onClick={() => onDelete(prompt.id)}
          className="text-danger text-xs ml-1"
        >
          confirm?
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="text-text-secondary hover:text-danger ml-1"
          aria-label="Delete saved prompt"
        >
          ×
        </button>
      )}
    </div>
  );
}
