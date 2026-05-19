import { useState, useEffect, useCallback, useRef } from 'react';
import { getBuilderState, runPrompt, applyManifest, deletePage } from '../api/builder.js';
import { usePageContext } from '../agent/usePageContext.js';
import { getTenant } from '../auth/useAuth.js';

const TOS_FRONTEND_ORIGIN = import.meta.env.VITE_TOS_FRONTEND_URL || 'http://localhost:5176';

// ── Component palette chip ────────────────────────────────────────────────────
function ComponentChip({ comp, onInsert }) {
  const categoryColors = {
    layout:      'bg-primary/10 text-primary border-primary/20',
    search:      'bg-teal-50 text-teal-700 border-teal-200',
    hotels:      'bg-blue-50 text-blue-700 border-blue-200',
    experiences: 'bg-purple-50 text-purple-700 border-purple-200',
    pois:        'bg-green-50 text-green-700 border-green-200',
    booking:     'bg-amber-50 text-amber-700 border-amber-200',
  };
  const cls = categoryColors[comp.category] || 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <button
      onClick={() => onInsert(comp)}
      title={comp.description}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium
                  transition-all hover:shadow-sm hover:scale-105 cursor-pointer ${cls}`}
    >
      <span>{comp.name}</span>
    </button>
  );
}

// ── Manifest section row ──────────────────────────────────────────────────────
function SectionRow({ section, index, total, onMove, onRemove, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const attrKeys = Object.keys(section.attrs || {});

  return (
    <div className="border border-border rounded-lg bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            className="text-text-secondary hover:text-text-primary disabled:opacity-20 leading-none"
            aria-label="Move up"
          >▲</button>
          <button
            onClick={() => onMove(index, 1)}
            disabled={index === total - 1}
            className="text-text-secondary hover:text-text-primary disabled:opacity-20 leading-none"
            aria-label="Move down"
          >▼</button>
        </div>
        <div className="flex-1 min-w-0">
          <code className="text-sm font-medium text-primary">{section.component}</code>
          {attrKeys.length > 0 && (
            <span className="ml-2 text-xs text-text-secondary truncate">
              {attrKeys.map(k => `${k}="${section.attrs[k]}"`).join('  ')}
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-text-secondary hover:text-primary px-2 py-1 rounded hover:bg-page-bg"
        >{expanded ? 'Hide' : 'Edit'}</button>
        <button
          onClick={() => onRemove(index)}
          className="text-danger hover:text-red-700 text-sm font-bold px-1"
          aria-label="Remove section"
        >✕</button>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-2 bg-page-bg">
          <div className="text-xs text-text-secondary mb-2">Attributes (JSON)</div>
          <textarea
            rows={3}
            className="w-full font-mono text-xs border border-border rounded px-2 py-1.5 bg-white resize-y focus:outline-none focus:ring-1 focus:ring-accent"
            value={JSON.stringify(section.attrs || {}, null, 2)}
            onChange={e => {
              try {
                const attrs = JSON.parse(e.target.value);
                onChange(index, { ...section, attrs });
              } catch { /* ignore parse errors while typing */ }
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main Builder page ─────────────────────────────────────────────────────────
export default function Builder() {
  const { register } = usePageContext();

  const [state, setState] = useState({ components: [], pages: [], current_page: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedSlug, setSelectedSlug] = useState('');
  const [manifest, setManifest] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef(null);

  const load = useCallback(async (slug) => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await getBuilderState(slug || undefined);
      setState(data);
      if (data.current_page) {
        setManifest(data.current_page.manifest);
        setSelectedSlug(data.current_page.slug);
      } else if (!slug) {
        setManifest(null);
      }
    } catch (e) {
      setLoadError(e.message || 'Failed to load builder state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    register('builder', { selected_page: selectedSlug });
  }, [selectedSlug, register]);

  const selectPage = (slug) => {
    setSelectedSlug(slug);
    setExplanation('');
    setPrompt('');
    load(slug);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setExplanation('');
    try {
      const result = await runPrompt(prompt, selectedSlug || null);
      setManifest(result.manifest);
      setExplanation(result.explanation || '');
    } catch (e) {
      alert('Generation failed: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!manifest) return;
    if (!Array.isArray(manifest.sections)) {
      setSaveMsg('Error: manifest has no sections array');
      return;
    }
    const pageId = state.current_page?.id || null;
    const resolvedSlug = newSlug || selectedSlug;
    const resolvedTitle = newTitle || newSlug || selectedSlug;
    if (!pageId && (!resolvedSlug || !resolvedTitle)) {
      setSaveMsg('Error: create a page first (set a slug and title)');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = pageId
        ? { page_id: pageId, manifest }
        : { page_slug: resolvedSlug, title: resolvedTitle, manifest };
      const saved = await applyManifest(payload);
      setSaveMsg('Saved!');
      setPreviewKey(k => k + 1);
      await load(saved.slug);
    } catch (e) {
      setSaveMsg('Error: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const handleInsertComponent = (comp) => {
    const attrs = {};
    (comp.schema?.attrs || []).forEach(a => { attrs[a] = ''; });
    const newSection = { component: comp.name, attrs };
    setManifest(m => ({
      ...(m || { layout: 'default' }),
      sections: [...(m?.sections || []), newSection],
    }));
  };

  const handleSectionMove = (idx, dir) => {
    setManifest(m => {
      const s = [...(m?.sections || [])];
      const target = idx + dir;
      if (target < 0 || target >= s.length) return m;
      [s[idx], s[target]] = [s[target], s[idx]];
      return { ...m, sections: s };
    });
  };

  const handleSectionRemove = (idx) => {
    setManifest(m => ({
      ...m,
      sections: (m?.sections || []).filter((_, i) => i !== idx),
    }));
  };

  const handleSectionChange = (idx, updated) => {
    setManifest(m => {
      const s = [...(m?.sections || [])];
      s[idx] = updated;
      return { ...m, sections: s };
    });
  };

  const _tenant = getTenant();
  const previewUrl = selectedSlug && _tenant?.tenant_id
    ? `${TOS_FRONTEND_ORIGIN}?pageSlug=${encodeURIComponent(selectedSlug)}&tenantId=${encodeURIComponent(_tenant.tenant_id)}`
    : null;

  const byCategory = state.components.reduce((acc, c) => {
    (acc[c.category] = acc[c.category] || []).push(c);
    return acc;
  }, {});

  if (loading && state.components.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-text-secondary">
          <div className="w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin" />
          <span className="text-sm">Loading builder…</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4 p-8">
        <div className="text-4xl">⚠️</div>
        <p className="text-text-primary font-semibold">Page Builder failed to load</p>
        <p className="text-sm text-text-secondary max-w-md text-center">{loadError}</p>
        <p className="text-xs text-text-secondary bg-amber-50 border border-amber-200 rounded px-3 py-2 max-w-md text-center">
          Make sure the Integration Hub is running and migrations are up to date:<br/>
          <code className="font-mono">npm run migrate</code> in the <code className="font-mono">integration-hub/</code> directory.
        </p>
        <button
          onClick={() => load()}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-primary transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>

      {/* ── Left panel: page list ─────────────────────────────────────── */}
      <aside className="w-56 shrink-0 border-r border-border bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">Pages</span>
          <button
            onClick={() => setShowNew(v => !v)}
            className="text-xs text-accent hover:underline"
          >+ New</button>
        </div>

        {showNew && (
          <div className="px-3 py-2 border-b border-border bg-page-bg space-y-1.5">
            <input
              className="w-full border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="slug (e.g. home)"
              value={newSlug}
              onChange={e => setNewSlug(e.target.value)}
            />
            <input
              className="w-full border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Title"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
            />
            <button
              onClick={() => {
                if (newSlug && newTitle) {
                  setManifest({ layout: 'default', sections: [] });
                  setSelectedSlug(newSlug);
                  setShowNew(false);
                }
              }}
              className="w-full text-xs bg-accent text-white rounded py-1 hover:bg-primary transition-colors"
            >Create</button>
          </div>
        )}

        <ul className="flex-1 overflow-y-auto py-1">
          {state.pages.map(p => (
            <li key={p.id}>
              <button
                onClick={() => selectPage(p.slug)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  p.slug === selectedSlug
                    ? 'bg-accent/10 text-accent font-medium border-l-2 border-accent'
                    : 'text-text-secondary hover:bg-page-bg hover:text-text-primary border-l-2 border-transparent'
                }`}
              >
                <div className="font-medium truncate">{p.title}</div>
                <div className="text-xs text-text-secondary truncate opacity-70">/{p.slug}</div>
              </button>
            </li>
          ))}
          {state.pages.length === 0 && !loading && (
            <li className="px-4 py-6 text-xs text-text-secondary text-center">
              No pages yet.<br />Create one above.
            </li>
          )}
        </ul>
      </aside>

      {/* ── Center: prompt + manifest editor ─────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Prompt bar */}
        <div className="px-4 py-3 border-b border-border bg-white flex gap-2">
          <textarea
            rows={2}
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/50 bg-page-bg"
            placeholder={selectedSlug
              ? `Describe changes to /${selectedSlug}… e.g. "Add an experience carousel for Paris after the hero"`
              : 'Select or create a page, then describe what you want…'}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium
                       hover:bg-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-end"
          >
            {generating ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Generating…
              </span>
            ) : 'Generate'}
          </button>
        </div>

        {/* Component palette */}
        <div className="px-4 py-2 border-b border-border bg-white/50 overflow-x-auto">
          <div className="flex gap-3 items-start min-w-max">
            {Object.entries(byCategory).map(([cat, comps]) => (
              <div key={cat} className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">{cat}</span>
                <div className="flex gap-1 flex-wrap">
                  {comps.map(c => (
                    <ComponentChip key={c.name} comp={c} onInsert={handleInsertComponent} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI explanation */}
        {explanation && (
          <div className="mx-4 mt-3 px-3 py-2 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-800">
            <span className="font-semibold">Agent: </span>{explanation}
          </div>
        )}

        {/* Section list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {!manifest && !loading && (
            <div className="text-center py-12 text-text-secondary text-sm">
              {selectedSlug
                ? 'Generate a layout with a prompt, or add components from the palette.'
                : 'Select a page from the left panel to get started.'}
            </div>
          )}
          {manifest?.sections?.map((section, i) => (
            <SectionRow
              key={i}
              section={section}
              index={i}
              total={manifest.sections.length}
              onMove={handleSectionMove}
              onRemove={handleSectionRemove}
              onChange={handleSectionChange}
            />
          ))}
        </div>

        {/* Apply bar */}
        {manifest && (
          <div className="px-4 py-3 border-t border-border bg-white flex items-center justify-between">
            <span className="text-sm text-text-secondary">
              {manifest.sections?.length ?? 0} section{manifest.sections?.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-3">
              {saveMsg && (
                <span className={`text-sm ${saveMsg.startsWith('Error') ? 'text-danger' : 'text-success'}`}>
                  {saveMsg}
                </span>
              )}
              <button
                onClick={handleApply}
                disabled={saving}
                className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium
                           hover:bg-accent transition-colors disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Apply & Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right panel: live preview ─────────────────────────────────── */}
      <div className="w-[420px] shrink-0 border-l border-border flex flex-col bg-page-bg">
        <div className="px-4 py-3 border-b border-border bg-white flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">Preview</span>
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline"
            >
              Open ↗
            </a>
          )}
        </div>
        <div className="flex-1 relative overflow-hidden">
          {previewUrl ? (
            <iframe
              key={previewKey}
              ref={iframeRef}
              src={previewUrl}
              title="TOS Frontend Preview"
              className="absolute inset-0 w-full h-full border-0 scale-[0.7] origin-top-left"
              style={{ width: '143%', height: '143%' }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-text-secondary">
              Save a page to see the live preview
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
