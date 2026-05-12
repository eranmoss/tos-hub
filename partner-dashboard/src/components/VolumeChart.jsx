import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function VolumeChart({ data }) {
  const rows = (data || []).map(d => ({
    hour: new Date(d.hour).toLocaleTimeString([], { hour: '2-digit' }),
    total: d.count,
    errors: d.errors,
  }));
  return (
    <div className="bg-card-bg rounded-card border border-border-default p-4 shadow-sm">
      <div className="text-sm font-medium text-text-primary mb-2">Volume — last 24h</div>
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="hour" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="total" stroke="#1A56A0" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="errors" stroke="#991B1B" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
