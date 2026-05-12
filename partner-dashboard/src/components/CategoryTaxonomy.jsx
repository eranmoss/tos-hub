import { useEffect, useState, useCallback } from 'react';
import {
  getCategories, getCategoryDetail, createCategory, updateCategory, deleteCategory,
  getCategoryMappings, createCategoryMapping, deleteCategoryMapping, getCategoryStats,
  getUnmappedCategories, autoMapCategories,
} from '../api/dashboard.js';

const Badge = ({ children, color = 'gray' }) => {
  const colors = {
    gray: 'bg-gray-100 text-gray-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-violet-50 text-violet-600',
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
};

const SUPPLIER_COLORS = {
  'viator-direct': 'text-emerald-600',
  'viator': 'text-emerald-600',
  'stubhub': 'text-blue-600',
  'hotelbeds-hotels': 'text-amber-600',
  'hotelbeds': 'text-amber-600',
};

const StatsBar = ({ stats }) => {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {[
        { label: 'Canonical Categories', value: stats.canonical_categories, color: 'text-accent' },
        { label: 'Supplier Mappings', value: stats.supplier_mappings, color: 'text-blue-600' },
        { label: 'Unmapped Supplier Cats', value: stats.unmapped_supplier_categories, color: stats.unmapped_supplier_categories > 0 ? 'text-amber-600' : 'text-emerald-600' },
        { label: 'Top-Level Categories', value: stats.top_level_categories, color: 'text-violet-600' },
      ].map((s) => (
        <div key={s.label} className="bg-card-bg border border-border-default rounded-card p-3 text-center">
          <div className={`text-xl font-bold ${s.color}`}>{s.value?.toLocaleString() ?? '—'}</div>
          <div className="text-[10px] text-text-secondary mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  );
};

const AddCategoryForm = ({ onCreated, parents }) => {
  const [id, setId] = useState('');
  const [display, setDisplay] = useState('');
  const [parentId, setParentId] = useState('');
  const [level, setLevel] = useState(0);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!id || !display) return;
    setSaving(true);
    try {
      await createCategory({ id: id.toLowerCase().replace(/\s+/g, '-'), display, parent_id: parentId || null, level });
      setId(''); setDisplay(''); setParentId(''); setLevel(0);
      onCreated();
    } catch (err) {
      alert(err.message);
    }
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 mb-4 p-3 bg-gray-50 rounded-card border border-border-default">
      <div className="flex-1">
        <label className="block text-[10px] text-text-secondary mb-0.5">ID (slug)</label>
        <input
          value={id} onChange={(e) => setId(e.target.value)}
          placeholder="food-tours" required
          className="w-full text-xs border border-border-default rounded-btn px-2 py-1.5 focus:border-accent outline-none"
        />
      </div>
      <div className="flex-1">
        <label className="block text-[10px] text-text-secondary mb-0.5">Display Name</label>
        <input
          value={display} onChange={(e) => setDisplay(e.target.value)}
          placeholder="Food Tours" required
          className="w-full text-xs border border-border-default rounded-btn px-2 py-1.5 focus:border-accent outline-none"
        />
      </div>
      <div className="w-40">
        <label className="block text-[10px] text-text-secondary mb-0.5">Parent</label>
        <select
          value={parentId} onChange={(e) => { setParentId(e.target.value); setLevel(e.target.value ? 1 : 0); }}
          className="w-full text-xs border border-border-default rounded-btn px-2 py-1.5 focus:border-accent outline-none bg-white"
        >
          <option value="">None (top-level)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>{p.display}</option>
          ))}
        </select>
      </div>
      <button
        type="submit" disabled={saving}
        className="bg-accent text-white text-xs px-4 py-1.5 rounded-btn hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
      >
        {saving ? 'Adding...' : 'Add Category'}
      </button>
    </form>
  );
};

const AddMappingForm = ({ categories, onCreated }) => {
  const [slug, setSlug] = useState('viator-direct');
  const [catId, setCatId] = useState('');
  const [catName, setCatName] = useState('');
  const [canonicalId, setCanonicalId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!slug || !catId || !canonicalId) return;
    setSaving(true);
    try {
      await createCategoryMapping({ supplier_slug: slug, supplier_cat_id: catId, supplier_cat_name: catName || null, canonical_cat_id: canonicalId });
      setCatId(''); setCatName('');
      onCreated();
    } catch (err) {
      alert(err.message);
    }
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 mb-4 p-3 bg-gray-50 rounded-card border border-border-default">
      <div className="w-36">
        <label className="block text-[10px] text-text-secondary mb-0.5">Supplier</label>
        <select
          value={slug} onChange={(e) => setSlug(e.target.value)}
          className="w-full text-xs border border-border-default rounded-btn px-2 py-1.5 bg-white"
        >
          <option value="viator-direct">viator-direct</option>
          <option value="stubhub">stubhub</option>
          <option value="hotelbeds-hotels">hotelbeds-hotels</option>
        </select>
      </div>
      <div className="flex-1">
        <label className="block text-[10px] text-text-secondary mb-0.5">Supplier Cat ID</label>
        <input
          value={catId} onChange={(e) => setCatId(e.target.value)}
          placeholder="12029" required
          className="w-full text-xs border border-border-default rounded-btn px-2 py-1.5"
        />
      </div>
      <div className="flex-1">
        <label className="block text-[10px] text-text-secondary mb-0.5">Supplier Cat Name</label>
        <input
          value={catName} onChange={(e) => setCatName(e.target.value)}
          placeholder="Historical Tours"
          className="w-full text-xs border border-border-default rounded-btn px-2 py-1.5"
        />
      </div>
      <div className="w-48">
        <label className="block text-[10px] text-text-secondary mb-0.5">Canonical Category</label>
        <select
          value={canonicalId} onChange={(e) => setCanonicalId(e.target.value)} required
          className="w-full text-xs border border-border-default rounded-btn px-2 py-1.5 bg-white"
        >
          <option value="">Select...</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.display} ({c.id})</option>
          ))}
        </select>
      </div>
      <button
        type="submit" disabled={saving}
        className="bg-blue-600 text-white text-xs px-4 py-1.5 rounded-btn hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
      >
        {saving ? 'Adding...' : 'Add Mapping'}
      </button>
    </form>
  );
};

const AutoMapPanel = ({ stats, onComplete }) => {
  const [supplier, setSupplier] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [dryRun, setDryRun] = useState(true);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await autoMapCategories({ supplier_slug: supplier || undefined, dry_run: dryRun });
      setResult(r);
      if (!dryRun) onComplete();
    } catch (e) {
      setResult({ error: e.message });
    }
    setRunning(false);
  };

  const unmappedCount = stats?.unmapped_supplier_categories || 0;

  return (
    <div className="mb-4 bg-amber-50 border border-amber-200 rounded-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-amber-800">LLM Category Mapper</h3>
          <p className="text-[10px] text-amber-600 mt-0.5">
            {unmappedCount > 0
              ? `${unmappedCount} supplier categories are unmapped. Use Claude to propose canonical mappings.`
              : 'All supplier categories are mapped.'}
          </p>
        </div>
      </div>

      <div className="flex items-end gap-3">
        <div className="w-44">
          <label className="block text-[10px] text-amber-700 mb-0.5">Supplier (optional)</label>
          <select
            value={supplier} onChange={(e) => setSupplier(e.target.value)}
            className="w-full text-xs border border-amber-300 rounded-btn px-2 py-1.5 bg-white"
          >
            <option value="">All suppliers</option>
            <option value="viator-direct">viator-direct</option>
            <option value="stubhub">stubhub</option>
            <option value="hotelbeds-hotels">hotelbeds-hotels</option>
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-amber-700 cursor-pointer">
          <input
            type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)}
            className="rounded border-amber-300"
          />
          Dry run (preview only)
        </label>
        <button
          type="button" onClick={run} disabled={running || unmappedCount === 0}
          className="bg-amber-600 text-white text-xs px-4 py-1.5 rounded-btn hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
        >
          {running ? 'Mapping...' : dryRun ? 'Preview Mappings' : 'Apply Mappings'}
        </button>
      </div>

      {result && !result.error && (
        <div className="mt-3 bg-white rounded-btn border border-amber-200 p-3">
          <div className="flex gap-4 text-xs mb-2">
            <span>Unmapped: <strong>{result.unmapped}</strong></span>
            <span>Mapped: <strong className="text-emerald-600">{result.mapped}</strong></span>
            <span>New categories: <strong className="text-blue-600">{result.created}</strong></span>
            <span>Skipped (flags): <strong className="text-gray-500">{result.skipped}</strong></span>
            {result.dry_run && <Badge color="amber">DRY RUN</Badge>}
          </div>
          {result.proposals?.length > 0 && (
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-2 py-1">Supplier Cat</th>
                    <th className="text-left px-2 py-1">Canonical</th>
                    <th className="text-center px-2 py-1">Confidence</th>
                    <th className="text-left px-2 py-1">Reason</th>
                    <th className="text-center px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.proposals.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-2 py-1 font-mono">{p.supplier_cat_id}</td>
                      <td className="px-2 py-1">
                        {p.skip ? <span className="text-gray-400 italic">skip</span> : (
                          <span>
                            {p.canonical_cat_id}
                            {p.is_new && <Badge color="blue">NEW</Badge>}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <span className={p.confidence >= 0.8 ? 'text-emerald-600' : p.confidence >= 0.5 ? 'text-amber-600' : 'text-red-500'}>
                          {(p.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-2 py-1 text-gray-500 max-w-[200px] truncate">{p.reason}</td>
                      <td className="px-2 py-1 text-center">
                        {p.skip ? <Badge color="gray">FLAG</Badge> :
                          p.confidence >= 0.8 ? <Badge color="green">OK</Badge> :
                          p.confidence >= 0.5 ? <Badge color="amber">?</Badge> :
                          <Badge color="red">LOW</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {result?.error && (
        <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-btn px-3 py-2">
          {result.error}
        </div>
      )}
    </div>
  );
};

export default function CategoryTaxonomy() {
  const [tab, setTab] = useState('categories');
  const [stats, setStats] = useState(null);
  const [categories, setCategories] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [detail, setDetail] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAutoMap, setShowAutoMap] = useState(false);
  const [loading, setLoading] = useState(false);

  const topLevel = categories.filter((c) => c.level === 0);

  const loadStats = useCallback(() => {
    getCategoryStats().then(setStats).catch(() => {});
  }, []);

  const loadCategories = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (levelFilter !== '') params.level = levelFilter;
    getCategories(params)
      .then((d) => setCategories(d.categories || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, levelFilter]);

  const loadMappings = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (supplierFilter) params.supplier_slug = supplierFilter;
    getCategoryMappings(params)
      .then((d) => setMappings(d.mappings || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, supplierFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => {
    if (tab === 'categories') loadCategories();
    else loadMappings();
  }, [tab, loadCategories, loadMappings]);

  const openDetail = async (id) => {
    try {
      const d = await getCategoryDetail(id);
      setDetail(d);
    } catch { /* ignore */ }
  };

  const handleDelete = async (id) => {
    if (!confirm(`Delete category "${id}" and all its mappings?`)) return;
    await deleteCategory(id);
    setDetail(null);
    loadCategories();
    loadStats();
  };

  const handleDeleteMapping = async (slug, catId) => {
    await deleteCategoryMapping({ supplier_slug: slug, supplier_cat_id: catId });
    loadMappings();
    loadStats();
  };

  return (
    <div>
      <StatsBar stats={stats} />

      {/* Tab row */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex gap-1">
          {[
            { key: 'categories', label: 'Canonical Categories' },
            { key: 'mappings', label: 'Supplier Mappings' },
          ].map((t) => (
            <button
              key={t.key} type="button"
              onClick={() => { setTab(t.key); setSearch(''); setDetail(null); }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-btn border transition-colors ${
                tab === t.key
                  ? 'bg-accent text-white border-accent'
                  : 'border-border-default text-text-secondary hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <input
          type="text" placeholder="Search..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="text-xs border border-border-default rounded-btn px-3 py-1.5 w-56 focus:border-accent outline-none"
        />
        {tab === 'categories' && (
          <select
            value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}
            className="text-xs border border-border-default rounded-btn px-2 py-1.5 bg-white"
          >
            <option value="">All Levels</option>
            <option value="0">Top-Level (0)</option>
            <option value="1">Sub-Category (1)</option>
          </select>
        )}
        {tab === 'mappings' && (
          <select
            value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}
            className="text-xs border border-border-default rounded-btn px-2 py-1.5 bg-white"
          >
            <option value="">All Suppliers</option>
            <option value="viator-direct">viator-direct</option>
            <option value="stubhub">stubhub</option>
            <option value="hotelbeds-hotels">hotelbeds-hotels</option>
          </select>
        )}
        <button
          type="button"
          onClick={() => { setShowAutoMap(!showAutoMap); setShowAdd(false); }}
          className={`text-xs border rounded-btn px-3 py-1.5 ${
            stats?.unmapped_supplier_categories > 0
              ? 'border-amber-500 text-amber-600 hover:bg-amber-50'
              : 'border-border-default text-text-secondary'
          }`}
        >
          {showAutoMap ? 'Hide Auto-Map' : `Auto-Map${stats?.unmapped_supplier_categories ? ` (${stats.unmapped_supplier_categories})` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => { setShowAdd(!showAdd); setShowAutoMap(false); }}
          className="text-xs border border-accent text-accent rounded-btn px-3 py-1.5 hover:bg-accent/5"
        >
          {showAdd ? 'Hide Form' : '+ Add'}
        </button>
      </div>

      {/* Auto-Map panel */}
      {showAutoMap && (
        <AutoMapPanel
          stats={stats}
          onComplete={() => { loadCategories(); loadMappings(); loadStats(); }}
        />
      )}

      {/* Add forms */}
      {showAdd && tab === 'categories' && (
        <AddCategoryForm parents={topLevel} onCreated={() => { loadCategories(); loadStats(); }} />
      )}
      {showAdd && tab === 'mappings' && (
        <AddMappingForm categories={categories.length ? categories : []} onCreated={() => { loadMappings(); loadStats(); }} />
      )}

      {/* Detail panel */}
      {detail && (
        <div className="mb-4 bg-card-bg border border-accent/30 rounded-card p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-text-primary">{detail.display}</h3>
              <div className="text-[10px] text-text-secondary mt-0.5">
                ID: <code className="bg-gray-100 px-1 rounded">{detail.id}</code>
                {detail.parent_id && <> &middot; Parent: <code className="bg-gray-100 px-1 rounded">{detail.parent_id}</code></>}
                &middot; Level {detail.level}
                &middot; {detail.product_count?.toLocaleString()} products
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button" onClick={() => handleDelete(detail.id)}
                className="text-[10px] text-red-500 hover:text-red-700 border border-red-200 rounded-btn px-2 py-1"
              >
                Delete
              </button>
              <button
                type="button" onClick={() => setDetail(null)}
                className="text-text-secondary hover:text-text-primary text-lg leading-none"
              >
                &times;
              </button>
            </div>
          </div>

          {detail.children?.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-text-secondary uppercase mb-1">Children</div>
              <div className="flex flex-wrap gap-1">
                {detail.children.map((c) => (
                  <button
                    key={c.id} type="button"
                    onClick={() => openDetail(c.id)}
                    className="text-[10px] px-2 py-0.5 rounded bg-violet-50 text-violet-600 hover:bg-violet-100"
                  >
                    {c.display}
                  </button>
                ))}
              </div>
            </div>
          )}

          {detail.mappings?.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-text-secondary uppercase mb-1">Supplier Mappings</div>
              <div className="space-y-1">
                {detail.mappings.map((m) => (
                  <div key={`${m.supplier_slug}-${m.supplier_cat_id}`} className="flex items-center gap-2 text-xs">
                    <span className={`font-medium ${SUPPLIER_COLORS[m.supplier_slug] || 'text-gray-600'}`}>
                      {m.supplier_slug}
                    </span>
                    <code className="bg-gray-100 px-1 rounded text-[10px]">{m.supplier_cat_id}</code>
                    <span className="text-text-secondary">{m.supplier_cat_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center text-text-secondary text-sm py-8">Loading...</div>
      ) : tab === 'categories' ? (
        <div className="bg-card-bg border border-border-default rounded-card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border-default">
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Category</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">ID</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Parent</th>
                <th className="text-center px-3 py-2 font-semibold text-text-secondary">Level</th>
                <th className="text-right px-3 py-2 font-semibold text-text-secondary">Mappings</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => openDetail(c.id)}
                  className="border-b border-border-default last:border-0 hover:bg-accent/5 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2 font-medium text-text-primary">{c.display}</td>
                  <td className="px-3 py-2">
                    <code className="bg-gray-100 px-1 rounded text-[10px]">{c.id}</code>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{c.parent_id || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge color={c.level === 0 ? 'purple' : c.level === 1 ? 'blue' : 'gray'}>L{c.level}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.mapping_count > 0 ? (
                      <Badge color="green">{c.mapping_count}</Badge>
                    ) : (
                      <Badge color="gray">0</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-text-secondary">No categories found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-card-bg border border-border-default rounded-card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border-default">
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Supplier</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Supplier Cat ID</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Supplier Name</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Canonical ID</th>
                <th className="text-left px-3 py-2 font-semibold text-text-secondary">Canonical Name</th>
                <th className="text-right px-3 py-2 font-semibold text-text-secondary">Products</th>
                <th className="text-center px-3 py-2 font-semibold text-text-secondary"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={`${m.supplier_slug}-${m.supplier_cat_id}`} className="border-b border-border-default last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <span className={`font-medium ${SUPPLIER_COLORS[m.supplier_slug] || 'text-gray-600'}`}>
                      {m.supplier_slug}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <code className="bg-gray-100 px-1 rounded text-[10px]">{m.supplier_cat_id}</code>
                  </td>
                  <td className="px-3 py-2 text-text-primary">{m.supplier_cat_name || '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => { setTab('categories'); openDetail(m.canonical_cat_id); }}
                      className="text-accent hover:underline"
                    >
                      {m.canonical_cat_id}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{m.canonical_display || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{m.product_count?.toLocaleString()}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleDeleteMapping(m.supplier_slug, m.supplier_cat_id)}
                      className="text-red-400 hover:text-red-600 text-[10px]"
                      title="Remove mapping"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
              {mappings.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-text-secondary">No mappings found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
