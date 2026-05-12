import { useState, useEffect, useCallback, useRef } from 'react';
import { getAttractions, getAttractionDetail, getAttractionAutocomplete } from '../api/dashboard.js';
import LifecycleDrawer from './LifecycleDrawer.jsx';

const SUPPLIER_COLORS = {
  bridgify: 'bg-blue-100 text-blue-800',
  'hotelbeds-activities': 'bg-orange-100 text-orange-800',
  'hotelbeds-hotels': 'bg-purple-100 text-purple-800',
  'hotelbeds-transfers': 'bg-green-100 text-green-800',
};

const SupplierBadge = ({ slug }) => (
  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${SUPPLIER_COLORS[slug] || 'bg-gray-100 text-gray-700'}`}>
    {slug}
  </span>
);

const ExperienceRow = ({ exp, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(exp)}
    className="w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-accent/5 transition-colors cursor-pointer"
  >
    {exp.image_urls?.[0] ? (
      <img src={exp.image_urls[0]} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />
    ) : (
      <div className="w-14 h-14 rounded bg-gray-100 flex-shrink-0 flex items-center justify-center text-gray-300 text-xs">
        No img
      </div>
    )}
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium leading-tight">{exp.title}</div>
      <div className="text-[11px] text-text-secondary flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
        {exp.category && <span>{exp.category}</span>}
        {exp.duration_minutes > 0 && <span>{exp.duration_minutes} min</span>}
        {exp.rating > 0 && (
          <span className="flex items-center gap-0.5">
            <svg className="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {exp.rating.toFixed(1)}
            {exp.review_count > 0 && <span className="text-text-secondary">({exp.review_count})</span>}
          </span>
        )}
        {exp.price_from > 0 && (
          <span className="font-medium text-text-primary">
            from {exp.price_currency || '$'}{exp.price_from.toFixed(0)}
          </span>
        )}
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      <SupplierBadge slug={exp.supplier_slug} />
      <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  </button>
);

const AttractionCard = ({ attraction, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(attraction)}
    className="w-full text-left border border-border-default rounded-card bg-card-bg hover:border-accent/40 transition-colors"
  >
    <div className="flex items-center gap-3 px-4 py-3">
      {attraction.image_url ? (
        <img src={attraction.image_url} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded bg-gradient-to-br from-accent/10 to-accent/5 flex-shrink-0 flex items-center justify-center">
          <svg className="w-5 h-5 text-accent/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{attraction.display_name}</div>
        <div className="text-[11px] text-text-secondary flex gap-2 mt-0.5">
          <span>{attraction.city}</span>
          {attraction.country && <span>{attraction.country}</span>}
          {attraction.category && <span className="text-accent/70">{attraction.category}</span>}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-lg font-bold text-accent">{attraction.experience_count}</div>
        <div className="text-[10px] text-text-secondary">experiences</div>
      </div>
    </div>
  </button>
);

const DetailPanel = ({ attraction, onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drawerRow, setDrawerRow] = useState(null);

  useEffect(() => {
    setLoading(true);
    getAttractionDetail(attraction.id)
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [attraction.id]);

  const supplierCounts = {};
  const expCount = data?.experiences?.length || 0;
  if (data?.experiences) {
    for (const e of data.experiences) {
      supplierCounts[e.supplier_slug] = (supplierCounts[e.supplier_slug] || 0) + 1;
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-accent hover:underline mb-3"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to search
      </button>

      <div className="bg-card-bg border border-border-default rounded-card p-4 mb-4">
        <div className="flex items-start gap-4">
          {attraction.image_url ? (
            <img src={attraction.image_url} alt="" className="w-20 h-20 rounded-lg object-cover" />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-accent/10 to-accent/5 flex items-center justify-center">
              <svg className="w-8 h-8 text-accent/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-lg font-bold">{attraction.display_name}</h2>
            <div className="text-sm text-text-secondary mt-0.5">
              {attraction.city}{attraction.country ? `, ${attraction.country}` : ''}
            </div>
            {attraction.category && (
              <span className="inline-block mt-1.5 text-[11px] px-2 py-0.5 rounded bg-accent/10 text-accent font-medium">
                {attraction.category}
              </span>
            )}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-accent">{expCount}</div>
            <div className="text-[11px] text-text-secondary">unique experiences</div>
          </div>
        </div>

        {Object.keys(supplierCounts).length > 0 && (
          <div className="flex gap-3 mt-3 pt-3 border-t border-border-default">
            {Object.entries(supplierCounts).map(([slug, count]) => (
              <div key={slug} className="flex items-center gap-1.5">
                <SupplierBadge slug={slug} />
                <span className="text-xs text-text-secondary">{count}</span>
              </div>
            ))}
          </div>
        )}

        {attraction.latitude && attraction.longitude && (
          <div className="text-[10px] text-text-secondary mt-2">
            {attraction.latitude.toFixed(5)}, {attraction.longitude.toFixed(5)}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-text-secondary py-8 text-center">Loading experiences...</div>
      ) : (
        <div className="border border-border-default rounded-card bg-card-bg divide-y divide-border-default">
          <div className="px-4 py-2 text-xs font-medium text-text-secondary bg-gray-50/50 rounded-t-card flex items-center justify-between">
            <span>Click an experience to view detail / availability / pricing</span>
            <span className="text-[10px]">{expCount} unique</span>
          </div>
          {(data?.experiences || []).map((exp) => (
            <ExperienceRow key={exp.id} exp={exp} onSelect={setDrawerRow} />
          ))}
          {expCount === 0 && (
            <div className="text-sm text-text-secondary py-6 text-center">No experiences linked</div>
          )}
        </div>
      )}

      <LifecycleDrawer
        open={!!drawerRow}
        row={drawerRow}
        onClose={() => setDrawerRow(null)}
      />
    </div>
  );
};

export default function AttractionExplorer() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [acLoading, setAcLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const onInputChange = (val) => {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setAcLoading(true);
    debounceRef.current = setTimeout(() => {
      getAttractionAutocomplete(val)
        .then(d => {
          setSuggestions(d.suggestions || []);
          setShowSuggestions(true);
        })
        .catch(() => {})
        .finally(() => setAcLoading(false));
    }, 200);
  };

  const pickSuggestion = (item) => {
    setShowSuggestions(false);
    setSuggestions([]);
    setSearchInput('');
    setSelected(item);
  };

  const submitSearch = (e) => {
    e?.preventDefault();
    setShowSuggestions(false);
    setSearch(searchInput);
    setPage(1);
  };

  const load = useCallback(() => {
    setLoading(true);
    const params = { page, limit: 30 };
    if (search) params.q = search;
    if (city) params.city = city;
    if (category) params.category = category;
    getAttractions(params)
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, search, city, category]);

  useEffect(() => { load(); }, [load]);

  if (selected) {
    return <DetailPanel attraction={selected} onBack={() => setSelected(null)} />;
  }

  const summary = data?.summary || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
          <div className="text-2xl font-bold">{summary.total_attractions?.toLocaleString() || '—'}</div>
          <div className="text-[11px] text-text-secondary">Attractions</div>
        </div>
        <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
          <div className="text-2xl font-bold text-accent">{summary.total_linked?.toLocaleString() || '—'}</div>
          <div className="text-[11px] text-text-secondary">Experiences Linked</div>
        </div>
        <div className="bg-card-bg border border-border-default rounded-card p-3 text-center">
          <div className="text-2xl font-bold">{summary.total_cities?.toLocaleString() || '—'}</div>
          <div className="text-[11px] text-text-secondary">Cities</div>
        </div>
      </div>

      <form onSubmit={submitSearch} className="flex gap-2 items-center">
        <div className="relative flex-1" ref={wrapperRef}>
          <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search attractions (e.g. Alhambra, Colosseum, Eiffel Tower...)"
            value={searchInput}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={() => { if (suggestions.length) setShowSuggestions(true); }}
            className="w-full pl-8 pr-3 py-2 text-sm border border-border-default rounded-btn bg-card-bg focus:outline-none focus:border-accent"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card-bg border border-border-default rounded-card shadow-lg max-h-80 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-accent/5 transition-colors border-b border-border-default last:border-0"
                >
                  {s.image_url ? (
                    <img src={s.image_url} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-accent/10 flex-shrink-0 flex items-center justify-center">
                      <svg className="w-4 h-4 text-accent/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{s.display_name}</div>
                    <div className="text-[11px] text-text-secondary">
                      {s.city}{s.country ? `, ${s.country}` : ''}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-xs font-semibold text-accent">{s.experience_count}</span>
                    <div className="text-[10px] text-text-secondary">exp</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {acLoading && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <button type="submit" className="rounded-btn bg-accent text-white text-sm px-4 py-2 hover:opacity-90">
          Search
        </button>
      </form>

      <div className="flex gap-2 items-center">
        <select
          value={city}
          onChange={(e) => { setCity(e.target.value); setPage(1); }}
          className="text-sm border border-border-default rounded-btn px-2 py-1.5 bg-card-bg min-w-[160px]"
        >
          <option value="">All cities</option>
          {(data?.cities || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          className="text-sm border border-border-default rounded-btn px-2 py-1.5 bg-card-bg min-w-[140px]"
        >
          <option value="">All categories</option>
          {(data?.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
            className="text-xs text-text-secondary hover:text-danger flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear search
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-text-secondary py-8 text-center">Loading attractions...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(data?.attractions || []).map((attr) => (
            <AttractionCard key={attr.id} attraction={attr} onSelect={setSelected} />
          ))}
          {data?.attractions?.length === 0 && (
            <div className="col-span-2 text-sm text-text-secondary py-8 text-center">
              No attractions found{search ? ` for "${search}"` : ''}
            </div>
          )}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary text-xs">
            Page {data.page} of {data.pages} ({data.total} attractions)
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 border border-border-default rounded-btn disabled:opacity-30">
              Prev
            </button>
            <button type="button" onClick={() => setPage(p => Math.min(data.pages, p + 1))}
              disabled={page >= data.pages}
              className="px-3 py-1 border border-border-default rounded-btn disabled:opacity-30">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
