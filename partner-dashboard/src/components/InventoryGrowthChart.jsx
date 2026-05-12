import { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { getInventoryGrowth } from '../api/dashboard.js';

const COLORS = {
  total: '#1A56A0',
  experiences: '#059669',
  hotels: '#D97706',
  transfers: '#7C3AED',
};

const fmtK = (v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v);

export default function InventoryGrowthChart() {
  const [data, setData] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [selected, setSelected] = useState('');

  const load = useCallback((slug) => {
    const params = slug ? { supplier_slug: slug } : {};
    getInventoryGrowth(params)
      .then((r) => {
        setData(r.days || []);
        if (r.experience_suppliers) setSuppliers(r.experience_suppliers);
      })
      .catch(() => setData([]));
  }, []);

  useEffect(() => { load(''); }, [load]);

  const onFilter = (slug) => {
    setSelected(slug);
    load(slug);
  };

  if (!data) return null;
  if (data.length === 0 && suppliers.length === 0) return null;

  const rows = data.map((d) => ({
    ...d,
    label: new Date(d.day + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }),
  }));

  return (
    <div className="bg-card-bg rounded-card border border-border-default p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-text-primary">
          Inventory growth — last 30 days
          {selected && <span className="text-text-secondary font-normal ml-1">({selected})</span>}
        </div>
        {suppliers.length > 1 && (
          <select
            value={selected}
            onChange={(e) => onFilter(e.target.value)}
            className="rounded-btn border border-border-default px-2 py-1 text-xs bg-page-bg"
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.supplier_slug} value={s.supplier_slug}>
                {s.supplier_slug} ({s.cnt.toLocaleString()})
              </option>
            ))}
          </select>
        )}
      </div>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="label" fontSize={11} interval={4} />
            <YAxis fontSize={11} tickFormatter={fmtK} />
            <Tooltip
              formatter={(v, name) => [v.toLocaleString(), name]}
              labelFormatter={(l) => l}
            />
            <Legend />
            <Line type="monotone" dataKey="total" name="Total" stroke={COLORS.total} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="experiences" name="Experiences" stroke={COLORS.experiences} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            <Line type="monotone" dataKey="hotels" name="Hotels" stroke={COLORS.hotels} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            <Line type="monotone" dataKey="transfers" name="Transfers" stroke={COLORS.transfers} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
