import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listAllComponents, generateComponentTemplate,
  createComponent, updateComponent, deleteComponent,
  getComponentSource, saveComponentSource,
} from '../api/builder.js';
import { getTenant } from '../auth/useAuth.js';

// ── Client-side code generator (mirrors backend generateCode) ─────────────────
const toPascalCase = (s) => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
const toCamelCase  = (s) => s.split('-').map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');

function buildPreviewCode({ name, attrs, hasDataFetch, datasource, templateHtml }) {
  if (!name) return '// Fill in a component name to see the preview';
  const className  = toPascalCase(name);
  const attrList   = attrs.filter(Boolean);
  const observedStr = attrList.map(a => `'${a}'`).join(', ');
  const attrVars   = attrList.length
    ? attrList.map(a => `    const ${toCamelCase(a)} = this.getAttribute('${a}') || '';`).join('\n') + '\n'
    : '';
  const safeHtml   = (templateHtml || `<div class="tos-card p-4">\n  <!-- ${name} -->\n</div>`).replace(/`/g, '\\`');

  if (hasDataFetch) {
    return `import { TosElement } from '../base.js';

class ${className} extends TosElement {${attrList.length ? `
  static get observedAttributes() { return [${observedStr}]; }
  attributeChangedCallback() { this.update(); }
` : ''}
  mount() {
    this.fetch(async () => {
      const { config } = await import('../../config.js');
      const r = await fetch(\`\${config.apiBase}${datasource || '/v1/catalog'}\`);
      if (!r.ok) throw new Error('Failed to load data');
      return r.json();
    });
  }

  template() {
    const data = this._data;
${attrVars}    return \`${safeHtml}\`;
  }
}

customElements.define('${name}', ${className});`;
  }

  return `class ${className} extends HTMLElement {${attrList.length ? `
  static get observedAttributes() { return [${observedStr}]; }
  attributeChangedCallback() { this._render(); }
` : ''}
  connectedCallback() { this._render(); }

  _render() {
${attrVars}    this.innerHTML = \`${safeHtml}\`;
  }
}

customElements.define('${name}', ${className});`;
}

// ── Category colour chips ─────────────────────────────────────────────────────
const CAT_COLORS = {
  layout:      'bg-primary/10 text-primary border-primary/20',
  search:      'bg-teal-50 text-teal-700 border-teal-200',
  hotels:      'bg-blue-50 text-blue-700 border-blue-200',
  experiences: 'bg-purple-50 text-purple-700 border-purple-200',
  pois:        'bg-green-50 text-green-700 border-green-200',
  booking:     'bg-amber-50 text-amber-700 border-amber-200',
  agent:       'bg-pink-50 text-pink-700 border-pink-200',
};
const catCls = (cat) => CAT_COLORS[cat] || 'bg-gray-50 text-gray-700 border-gray-200';

const BLANK = { name: '', category: '', description: '', attrs: [''], hasDataFetch: false, datasource: '', templateHtml: '' };

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ComponentEditor() {
  const [components, setComponents] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState('');
  const [selected,   setSelected]   = useState(null); // component name being edited
  const [form,       setForm]       = useState(BLANK);
  const [saving,     setSaving]     = useState(false);
  const [saveMsg,    setSaveMsg]    = useState('');
  const [generating, setGenerating] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [fileSource,    setFileSource]    = useState(null);
  const [editedSource,  setEditedSource]  = useState(null);
  const [savingSource,  setSavingSource]  = useState(false);
  const [sourceTab,     setSourceTab]     = useState('form'); // 'form' | 'source'
  const [previewKey,    setPreviewKey]    = useState(0);
  const [rightPanel,    setRightPanel]    = useState('preview'); // 'preview' | 'code'
  const iframeRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const list = await listAllComponents();
      setComponents(list);
    } catch (e) {
      setLoadError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Select a component to edit
  const handleSelect = async (comp) => {
    setSelected(comp.name);
    setFileSource(null);
    setRightPanel('preview');
    setSourceTab(comp.template_html ? 'form' : 'source');
    setForm({
      name:         comp.name,
      category:     comp.category || '',
      description:  comp.description || '',
      attrs:        comp.schema?.attrs?.length ? comp.schema.attrs : [''],
      hasDataFetch: comp.has_data_fetch || false,
      datasource:   comp.datasource_bindings?.api || '',
      templateHtml: comp.template_html || '',
    });
    setSaveMsg('');
    setEditedSource(null);
    // Always load the file source so we can show it
    try {
      const src = await getComponentSource(comp.name);
      setFileSource(src);
      setEditedSource(src?.source || null);
    } catch { /* non-fatal */ }
  };

  const handleNew = () => {
    setSelected(null);
    setForm(BLANK);
    setFileSource(null);
    setEditedSource(null);
    setSourceTab('form');
    setSaveMsg('');
  };

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleAttrChange = (i, val) => {
    setForm(f => {
      const a = [...f.attrs];
      a[i] = val;
      return { ...f, attrs: a };
    });
  };
  const addAttr    = () => setForm(f => ({ ...f, attrs: [...f.attrs, ''] }));
  const removeAttr = (i) => setForm(f => ({ ...f, attrs: f.attrs.filter((_, j) => j !== i) }));

  const handleGenerate = async () => {
    if (!form.name || !form.category) {
      setSaveMsg('Error: set a name and category first');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    setGenerating(true);
    try {
      const { template_html } = await generateComponentTemplate({
        name: form.name, category: form.category,
        description: form.description,
        attrs: form.attrs.filter(Boolean),
        has_data_fetch: form.hasDataFetch,
        datasource: form.datasource,
      });
      setField('templateHtml', template_html);
      setSourceTab('form');
      setRightPanel('code'); // switch to Generated tab so user sees the result
    } catch (e) {
      setSaveMsg('Error: ' + (e.response?.data?.error || e.message));
      setTimeout(() => setSaveMsg(''), 4000);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.category) {
      setSaveMsg('Error: name and category are required');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    if (!/^tos-[a-z][a-z0-9-]*$/.test(form.name)) {
      setSaveMsg('Error: name must start with "tos-" and be kebab-case');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = {
        name:         form.name,
        category:     form.category,
        description:  form.description,
        attrs:        form.attrs.filter(Boolean),
        has_data_fetch: form.hasDataFetch,
        datasource:   form.datasource,
        template_html: form.templateHtml,
      };
      if (selected) {
        await updateComponent(selected, payload);
      } else {
        await createComponent(payload);
      }
      setSaveMsg('Saved! File written to tos-frontend/src/components/' + form.category + '/' + form.name + '.js');
      setSelected(form.name);
      await load();
    } catch (e) {
      setSaveMsg('Error: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 5000);
    }
  };

  const handleSaveSource = async () => {
    if (!selected || editedSource === null) return;
    setSavingSource(true);
    setSaveMsg('');
    try {
      await saveComponentSource(selected, editedSource);
      setFileSource(f => ({ ...f, source: editedSource }));
      setSaveMsg('Source file saved to disk.');
    } catch (e) {
      setSaveMsg('Error: ' + (e.response?.data?.error || e.message));
    } finally {
      setSavingSource(false);
      setTimeout(() => setSaveMsg(''), 4000);
    }
  };

  const handleDelete = async (name) => {
    try {
      await deleteComponent(name);
      setConfirmDel(null);
      if (selected === name) { setSelected(null); setForm(BLANK); }
      await load();
    } catch (e) {
      setSaveMsg('Error: ' + (e.response?.data?.error || e.message));
      setConfirmDel(null);
    }
  };

  const byCategory = components.reduce((acc, c) => {
    (acc[c.category] = acc[c.category] || []).push(c);
    return acc;
  }, {});

  const previewCode = buildPreviewCode({
    name:         form.name,
    attrs:        form.attrs,
    hasDataFetch: form.hasDataFetch,
    datasource:   form.datasource,
    templateHtml: form.templateHtml,
  });

  const TOS_FRONTEND_ORIGIN = import.meta.env.VITE_TOS_FRONTEND_URL || 'http://localhost:5175';
  const _tenant = getTenant();
  const previewUrl = form.name
    ? `${TOS_FRONTEND_ORIGIN}?preview=${encodeURIComponent(form.name)}${_tenant?.tenant_id ? `&tenantId=${encodeURIComponent(_tenant.tenant_id)}` : ''}`
    : null;

  if (loading && !components.length) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-text-secondary">
          <div className="w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin" />
          <span className="text-sm">Loading components…</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4 p-8">
        <p className="text-text-primary font-semibold">Failed to load components</p>
        <p className="text-sm text-text-secondary">{loadError}</p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Run <code>npm run migrate</code> in integration-hub/ if migration 018 is missing.
        </p>
        <button onClick={load} className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-primary">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>

      {/* ── Left: component list ─────────────────────────────────────────── */}
      <aside className="w-60 shrink-0 border-r border-border bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">Components</span>
          <button
            onClick={handleNew}
            className="text-xs text-accent hover:underline"
          >+ New</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {Object.entries(byCategory).map(([cat, comps]) => (
            <div key={cat}>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-text-secondary font-semibold bg-page-bg border-b border-border">
                {cat}
              </div>
              {comps.map(c => (
                <button
                  key={c.name}
                  onClick={() => handleSelect(c)}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors border-l-2 ${
                    c.name === selected
                      ? 'bg-accent/10 text-accent font-medium border-accent'
                      : 'text-text-secondary hover:bg-page-bg hover:text-text-primary border-transparent'
                  } ${!c.is_active ? 'opacity-40 line-through' : ''}`}
                >
                  <span className="truncate block">{c.name}</span>
                  {c.usage_count > 0 && (
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-text-secondary font-normal">
                      <svg className="w-2.5 h-2.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/>
                      </svg>
                      {c.usage_count} {c.usage_count === 1 ? 'page' : 'pages'}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {components.length === 0 && (
            <div className="px-4 py-8 text-xs text-text-secondary text-center">
              No components yet.<br />Click + New to create one.
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-border text-xs text-text-secondary">
          {components.filter(c => c.is_active).length} active · {components.length} total
        </div>
      </aside>

      {/* ── Center: editor form ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="px-5 py-3 border-b border-border bg-white flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">
            {selected ? `Editing ${selected}` : 'New Component'}
          </h2>
          {selected && (
            <button
              onClick={() => setConfirmDel(selected)}
              className="text-xs text-danger hover:underline"
            >Deactivate</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Usage info */}
          {selected && (() => {
            const comp = components.find(c => c.name === selected);
            const pages = comp?.used_in_pages || [];
            return pages.length > 0 ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-800">
                <svg className="w-3.5 h-3.5 shrink-0 text-teal-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/>
                </svg>
                <span>
                  Used on {pages.length} {pages.length === 1 ? 'page' : 'pages'}:{' '}
                  <span className="font-medium">{pages.map(p => p.title || p.slug).join(', ')}</span>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-border text-xs text-text-secondary">
                <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
                </svg>
                Not used on any pages yet
              </div>
            );
          })()}

          {/* Name + Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Component name <span className="text-danger">*</span>
              </label>
              <input
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono
                           focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="tos-my-component"
                value={form.name}
                disabled={!!selected}
                onChange={e => setField('name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              />
              {form.name && !/^tos-/.test(form.name) && (
                <p className="text-xs text-danger mt-1">Must start with "tos-"</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Category <span className="text-danger">*</span>
              </label>
              <input
                className="w-full border border-border rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="hotels, experiences, layout…"
                value={form.category}
                onChange={e => setField('category', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                list="cat-suggestions"
              />
              <datalist id="cat-suggestions">
                {['layout','search','hotels','experiences','pois','booking','transfers','agent'].map(c =>
                  <option key={c} value={c} />
                )}
              </datalist>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Description</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-accent/50"
              placeholder="One-line description of what this component does"
              value={form.description}
              onChange={e => setField('description', e.target.value)}
            />
          </div>

          {/* Attributes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-text-secondary">HTML Attributes</label>
              <button onClick={addAttr} className="text-xs text-accent hover:underline">+ Add attr</button>
            </div>
            <div className="space-y-1.5">
              {form.attrs.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="flex-1 border border-border rounded px-2 py-1.5 text-xs font-mono
                               focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder={`attr-name (e.g. product-id)`}
                    value={a}
                    onChange={e => handleAttrChange(i, e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  />
                  <button
                    onClick={() => removeAttr(i)}
                    className="text-danger hover:text-red-700 text-sm px-1 font-bold"
                    aria-label="Remove"
                  >✕</button>
                </div>
              ))}
            </div>
            {form.attrs.some(Boolean) && (
              <p className="text-[11px] text-text-secondary mt-1">
                In your template, use <code className="bg-gray-100 px-1 rounded">${'{'}attrName{'}'}</code> (camelCase).
              </p>
            )}
          </div>

          {/* Data fetch toggle */}
          <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-page-bg">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-border text-accent"
                checked={form.hasDataFetch}
                onChange={e => setField('hasDataFetch', e.target.checked)}
              />
              <span className="text-sm font-medium text-text-primary">Fetch data from Integration Hub</span>
            </label>
            {form.hasDataFetch && (
              <input
                className="flex-1 border border-border rounded px-2 py-1.5 text-xs font-mono
                           focus:outline-none focus:ring-1 focus:ring-accent bg-white"
                placeholder="/v1/catalog/hotels"
                value={form.datasource}
                onChange={e => setField('datasource', e.target.value)}
              />
            )}
          </div>

          {/* Template HTML */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-secondary">
                HTML Template
                {form.hasDataFetch
                  ? <span className="ml-1 text-text-secondary font-normal">— returned from template()</span>
                  : <span className="ml-1 text-text-secondary font-normal">— set as innerHTML</span>}
              </label>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-1.5 text-xs text-teal-700 hover:text-teal-900 font-medium
                           bg-teal-50 border border-teal-200 rounded px-2 py-1 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating
                  ? <><span className="w-3 h-3 border border-teal-400 border-t-teal-700 rounded-full animate-spin" /> Generating…</>
                  : '✨ Generate with AI'}
              </button>
            </div>
            <textarea
              rows={10}
              className="w-full border border-border rounded-lg px-3 py-2 text-xs font-mono resize-y
                         focus:outline-none focus:ring-2 focus:ring-accent/50 bg-white"
              placeholder={`<div class="tos-card p-4">\n  <h3 class="font-semibold">\${title}</h3>\n</div>`}
              value={form.templateHtml}
              onChange={e => setField('templateHtml', e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Save bar */}
          <div className="flex items-center justify-between pt-2 pb-4">
            <div>
              {saveMsg && (
                <p className={`text-sm ${saveMsg.startsWith('Error') ? 'text-danger' : 'text-success'}`}>
                  {saveMsg}
                </p>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-primary text-white text-sm font-medium rounded-lg
                         hover:bg-accent transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving…' : selected ? 'Update Component' : 'Create Component'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: live preview + code panel ────────────────────────────── */}
      <div className="w-[440px] shrink-0 border-l border-border flex flex-col bg-gray-900">

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setRightPanel('preview')}
            className={`px-4 py-2.5 text-xs font-medium transition-colors ${
              rightPanel === 'preview' ? 'text-white border-b-2 border-accent' : 'text-white/50 hover:text-white/80'
            }`}
          >Live Preview</button>
          <button
            onClick={() => { setSourceTab('source'); setRightPanel('code'); }}
            className={`px-4 py-2.5 text-xs font-medium transition-colors ${
              rightPanel === 'code' && sourceTab === 'source' ? 'text-white border-b-2 border-accent' : 'text-white/50 hover:text-white/80'
            }`}
          >
            Source File
            {fileSource?.source && <span className="ml-1.5 text-[10px] bg-green-700/50 text-green-300 rounded px-1">on disk</span>}
          </button>
          <button
            onClick={() => { setSourceTab('form'); setRightPanel('code'); }}
            className={`px-4 py-2.5 text-xs font-medium transition-colors ${
              rightPanel === 'code' && sourceTab === 'form' ? 'text-white border-b-2 border-accent' : 'text-white/50 hover:text-white/80'
            }`}
          >Generated</button>
          <div className="flex-1" />
          {rightPanel === 'preview' && previewUrl && (
            <button onClick={() => setPreviewKey(k => k + 1)} className="px-3 text-xs text-white/40 hover:text-white/70">↺</button>
          )}
          {rightPanel === 'code' && (
            <button
              onClick={() => navigator.clipboard?.writeText(sourceTab === 'source' ? (fileSource?.source || '') : previewCode)}
              className="px-3 text-xs text-white/40 hover:text-white/70"
            >Copy</button>
          )}
        </div>

        {rightPanel === 'preview' ? (
          <div className="flex-1 relative overflow-hidden bg-white">
            {previewUrl ? (
              <iframe
                key={previewKey}
                ref={iframeRef}
                src={previewUrl}
                title="Component Preview"
                className="absolute inset-0 w-full h-full border-0"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-gray-400">
                Select a component to preview it
              </div>
            )}
          </div>
        ) : sourceTab === 'source' ? (
          <>
            {editedSource !== null ? (
              <textarea
                className="flex-1 p-4 text-xs text-green-300 font-mono leading-relaxed bg-transparent
                           resize-none focus:outline-none border-0 w-full"
                value={editedSource}
                onChange={e => setEditedSource(e.target.value)}
                spellCheck={false}
              />
            ) : selected ? (
              <div className="flex-1 flex items-center justify-center p-6 text-center">
                <div className="text-white/40 text-sm">
                  {fileSource === null
                    ? <span className="flex gap-2 items-center"><span className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" /> Loading…</span>
                    : 'File not found on disk'}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-center text-white/30 text-sm">
                Select a component to view and edit its source
              </div>
            )}
            <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between gap-3">
              <span className="text-[11px] text-white/40 font-mono truncate flex-1">
                {fileSource?.path || ''}
              </span>
              {editedSource !== null && (
                <button
                  onClick={handleSaveSource}
                  disabled={savingSource || editedSource === fileSource?.source}
                  className="shrink-0 px-3 py-1 text-xs bg-accent text-white rounded
                             hover:bg-primary transition-colors disabled:opacity-40"
                >
                  {savingSource ? 'Saving…' : 'Save to disk'}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <pre className="flex-1 overflow-auto p-4 text-xs text-green-300 font-mono leading-relaxed whitespace-pre">
              {previewCode}
            </pre>
            {form.name && form.category && (
              <div className="px-4 py-2 border-t border-white/10 text-[11px] text-white/40 font-mono">
                {'→ tos-frontend/src/components/'}{form.category}/{form.name}.js
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Confirm delete modal ─────────────────────────────────────────── */}
      {confirmDel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-text-primary mb-2">Deactivate component?</h3>
            <p className="text-sm text-text-secondary mb-4">
              <code className="bg-gray-100 px-1 rounded">{confirmDel}</code> will be hidden from the Page Builder palette.
              The JS file on disk is kept.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDel(null)}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-page-bg"
              >Cancel</button>
              <button
                onClick={() => handleDelete(confirmDel)}
                className="px-4 py-2 text-sm bg-danger text-white rounded-lg hover:bg-red-700"
              >Deactivate</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
