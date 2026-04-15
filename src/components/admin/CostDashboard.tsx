'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const SERVICE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  groq: 'Groq',
  'apify-short': 'Apify Short',
  'apify-full': 'Apify Full',
  serper: 'Serper',
  apollo: 'Apollo',
  perplexity: 'Perplexity',
  'openai-embeddings': 'OpenAI Embeddings',
};

const COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
];

function formatCost(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

interface SummarySection {
  totalCost: number;
  callCount: number;
}

interface ServiceRow {
  service: string;
  totalCost: number;
  callCount: number;
}

interface ActionRow {
  action: string;
  totalCost: number;
  callCount: number;
  avgCost: number;
}

interface UserRow {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  totalCost: number;
  callCount: number;
}

interface DailySpendRow {
  date: string;
  service: string;
  totalCost: number;
  callCount: number;
}

interface CostData {
  summary: {
    today: SummarySection;
    week: SummarySection;
    filtered: SummarySection;
  };
  byService: ServiceRow[];
  byAction: ActionRow[];
  byUser: UserRow[];
  dailySpend: DailySpendRow[];
  dateRange: { start: string; end: string };
}

const DATE_RANGES = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function CostDashboard() {
  const [rangeDays, setRangeDays] = useState(30);
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const params = new URLSearchParams({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });

      const res = await fetch(`/api/admin/costs?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(rangeDays);
  }, [rangeDays, fetchData]);

  // Build daily spend pivot for recharts stacked bar chart
  const allServices = data
    ? Array.from(new Set(data.dailySpend.map((r) => r.service)))
    : [];

  const dailyChartData = data
    ? (() => {
        const byDate: Record<string, Record<string, number>> = {};
        for (const row of data.dailySpend) {
          if (!byDate[row.date]) byDate[row.date] = {};
          byDate[row.date][row.service] = Number(row.totalCost);
        }
        return Object.entries(byDate).map(([date, services]) => ({
          date,
          ...services,
        }));
      })()
    : [];

  const pieData = data
    ? data.byService.map((r, i) => ({
        name: SERVICE_LABELS[r.service] ?? r.service,
        value: Number(r.totalCost),
        color: COLORS[i % COLORS.length],
      }))
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-surface-400">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface-100 rounded-xl border border-surface-200 p-5 text-red-600">
        Error: {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Date range toggle */}
      <div className="flex gap-2">
        {DATE_RANGES.map(({ label, days }) => (
          <button
            key={label}
            onClick={() => setRangeDays(days)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              rangeDays === days
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-surface-200 text-surface-500 border-surface-300 hover:bg-surface-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface-100 rounded-xl border border-surface-200 p-5">
          <p className="text-sm text-surface-500 mb-1">Today</p>
          <p className="text-3xl font-bold text-surface-900 font-mono">
            {formatCost(data.summary.today.totalCost)}
          </p>
          <p className="text-xs text-surface-400 mt-1">
            {data.summary.today.callCount.toLocaleString()} calls
          </p>
        </div>
        <div className="bg-surface-100 rounded-xl border border-surface-200 p-5">
          <p className="text-sm text-surface-500 mb-1">Last 7 Days</p>
          <p className="text-3xl font-bold text-surface-900 font-mono">
            {formatCost(data.summary.week.totalCost)}
          </p>
          <p className="text-xs text-surface-400 mt-1">
            {data.summary.week.callCount.toLocaleString()} calls
          </p>
        </div>
        <div className="bg-surface-100 rounded-xl border border-surface-200 p-5">
          <p className="text-sm text-surface-500 mb-1">Last {rangeDays} Days</p>
          <p className="text-3xl font-bold text-surface-900 font-mono">
            {formatCost(data.summary.filtered.totalCost)}
          </p>
          <p className="text-xs text-surface-400 mt-1">
            {data.summary.filtered.callCount.toLocaleString()} calls
          </p>
        </div>
      </div>

      {/* Daily spend stacked bar chart */}
      <div className="bg-surface-100 rounded-xl border border-surface-200 p-5">
        <h2 className="text-base font-semibold text-surface-900 mb-4">Daily Spend by Service</h2>
        {dailyChartData.length === 0 ? (
          <p className="text-surface-400 text-sm py-8 text-center">No data</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyChartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#303030" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#b0b0b0' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#b0b0b0' }}
                tickLine={false}
                tickFormatter={(v) => `$${Number(v).toFixed(3)}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #303030', borderRadius: '8px' }}
                labelStyle={{ color: '#d0d0d0' }}
                itemStyle={{ color: '#e8e8e8' }}
                formatter={(value, name) => [
                  formatCost(Number(value ?? 0)),
                  SERVICE_LABELS[String(name)] ?? String(name),
                ]}
              />
              <Legend
                formatter={(value) => SERVICE_LABELS[value] ?? value}
                wrapperStyle={{ fontSize: 12, color: '#d0d0d0' }}
              />
              {allServices.map((service, i) => (
                <Bar
                  key={service}
                  dataKey={service}
                  stackId="spend"
                  fill={COLORS[i % COLORS.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Service breakdown: pie + table */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-surface-100 rounded-xl border border-surface-200 p-5">
          <h2 className="text-base font-semibold text-surface-900 mb-4">Spend by Service</h2>
          {pieData.length === 0 ? (
            <p className="text-surface-400 text-sm py-8 text-center">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent, x, y, textAnchor }) => (
                    <text x={x} y={y} textAnchor={textAnchor} fill="#d0d0d0" fontSize={11}>
                      {`${name} ${((percent ?? 0) * 100).toFixed(1)}%`}
                    </text>
                  )}
                  labelLine={false}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #303030', borderRadius: '8px' }}
                  itemStyle={{ color: '#e8e8e8' }}
                  formatter={(value) => formatCost(Number(value ?? 0))}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-surface-100 rounded-xl border border-surface-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-100">
            <h2 className="text-base font-semibold text-surface-900">Service Summary</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-surface-600">Service</th>
                  <th className="text-right px-4 py-3 font-medium text-surface-600">Total</th>
                  <th className="text-right px-4 py-3 font-medium text-surface-600">Calls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {data.byService.map((row, i) => (
                  <tr key={row.service} className="hover:bg-surface-50">
                    <td className="px-4 py-2.5 flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="text-surface-700">
                        {SERVICE_LABELS[row.service] ?? row.service}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-surface-800">
                      {formatCost(Number(row.totalCost))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-surface-500">
                      {Number(row.callCount).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {data.byService.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-surface-400">
                      No data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* By action */}
      <div className="bg-surface-100 rounded-xl border border-surface-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-100">
          <h2 className="text-base font-semibold text-surface-900">Spend by Action</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-surface-600">Action</th>
                <th className="text-right px-4 py-3 font-medium text-surface-600">Total</th>
                <th className="text-right px-4 py-3 font-medium text-surface-600">Calls</th>
                <th className="text-right px-4 py-3 font-medium text-surface-600">Avg/Call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {data.byAction.map((row) => (
                <tr key={row.action} className="hover:bg-surface-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-surface-700">{row.action}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-surface-800">
                    {formatCost(Number(row.totalCost))}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-surface-500">
                    {Number(row.callCount).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-surface-500">
                    {formatCost(Number(row.avgCost))}
                  </td>
                </tr>
              ))}
              {data.byAction.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-surface-400">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* By user */}
      <div className="bg-surface-100 rounded-xl border border-surface-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-100">
          <h2 className="text-base font-semibold text-surface-900">Spend by User (Top 20)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-surface-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-surface-600">Email</th>
                <th className="text-right px-4 py-3 font-medium text-surface-600">Total</th>
                <th className="text-right px-4 py-3 font-medium text-surface-600">Calls</th>
                <th className="text-right px-4 py-3 font-medium text-surface-600">Avg/Call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {data.byUser.map((row, i) => {
                const avg =
                  Number(row.callCount) > 0
                    ? Number(row.totalCost) / Number(row.callCount)
                    : 0;
                return (
                  <tr key={row.userId ?? `anon-${i}`} className="hover:bg-surface-50">
                    <td className="px-4 py-2.5 text-surface-800">
                      {row.userName ?? <span className="text-surface-400 italic">Unknown</span>}
                    </td>
                    <td className="px-4 py-2.5 text-surface-500">
                      {row.userEmail ?? <span className="text-surface-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-surface-800">
                      {formatCost(Number(row.totalCost))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-surface-500">
                      {Number(row.callCount).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-surface-500">
                      {formatCost(avg)}
                    </td>
                  </tr>
                );
              })}
              {data.byUser.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-surface-400">
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
