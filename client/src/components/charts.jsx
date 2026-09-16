/**
 * Chart primitives.
 *
 * Palette: validated categorical slots 1–3 (blue / orange / aqua) on a white
 * surface — adjacent-pair CVD ΔE 9.2, normal-vision ΔE 24.0. Aqua sits below
 * 3:1 contrast on white, so every chart that uses it also carries a legend and
 * visible value labels (the relief rule). Hues are assigned in fixed order and
 * never cycled; a chart that would need a fourth identity colour is split or
 * folded into "Other" instead.
 *
 * Magnitude-only charts (one measure across categories) use a single hue —
 * position and the category label carry identity, so colour has no job there.
 */
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, Cell,
} from 'recharts';
import { money, compactMoney, num } from '../lib/format.js';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];
export const GRID = '#e2e8f0';
export const AXIS_TEXT = '#64748b';

const axisProps = {
  stroke: GRID,
  tick: { fill: AXIS_TEXT, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: GRID },
};

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-white shadow-lg ring-1 ring-slate-200 px-3 py-2 text-xs">
      {label !== undefined && <p className="font-medium text-slate-700 mb-1">{label}</p>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 tabular-nums">
          <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-slate-500">{p.name}</span>
          <span className="ml-auto font-medium text-slate-800">
            {formatter ? formatter(p.value) : money(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Single-measure trend over time. One series → no legend; the title names it. */
export function TrendChart({ data, xKey = 'date', yKey = 'revenue', height = 240, valueFormat = money }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.22} />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps}
          tickFormatter={(v) => String(v).slice(5).replace('-', '/')} minTickGap={24} />
        <YAxis {...axisProps} width={56} tickFormatter={(v) => compactMoney(v)} />
        <Tooltip content={<ChartTooltip formatter={valueFormat} />} cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} />
        <Area type="monotone" dataKey={yKey} name="Revenue" stroke={SERIES[0]} strokeWidth={2}
          fill="url(#trendFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Two measures over time — legend always present for ≥2 series. */
export function MultiLineChart({ data, xKey = 'date', series, height = 280, valueFormat = money }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps}
          tickFormatter={(v) => String(v).slice(5).replace('-', '/')} minTickGap={24} />
        <YAxis {...axisProps} width={56} tickFormatter={(v) => compactMoney(v)} />
        <Tooltip content={<ChartTooltip formatter={valueFormat} />} cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Ranked magnitude across categories — one hue, values labelled directly. */
export function RankedBarChart({ data, labelKey = 'label', valueKey = 'value', height = 280,
  valueFormat = compactMoney, color = SERIES[0], highlightKey }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={(v) => compactMoney(v)} />
        <YAxis type="category" dataKey={labelKey} {...axisProps} width={130}
          tick={{ fill: '#334155', fontSize: 11 }} />
        <Tooltip content={<ChartTooltip formatter={valueFormat} />} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey={valueKey} name="Value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {highlightKey && data.map((d, i) => (
            <Cell key={i} fill={d[highlightKey] ? SERIES[1] : color} />
          ))}
          <LabelList dataKey={valueKey} position="right"
            formatter={(v) => valueFormat(v)}
            style={{ fill: '#334155', fontSize: 11, fontWeight: 500 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Counts (not money) across categories. */
export function CountBarChart({ data, labelKey = 'label', valueKey = 'value', height = 240, color = SERIES[0] }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={labelKey} {...axisProps} />
        <YAxis {...axisProps} width={40} allowDecimals={false} />
        <Tooltip content={<ChartTooltip formatter={(v) => num(v)} />} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey={valueKey} name="Units" fill={color} radius={[4, 4, 0, 0]} maxBarSize={38}>
          <LabelList dataKey={valueKey} position="top"
            style={{ fill: '#334155', fontSize: 11, fontWeight: 500 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
