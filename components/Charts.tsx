"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RULES, type SkuResult } from "@/lib/rules";

export const ACTION_COLOR = (action: string) =>
  action.startsWith("REORDER") ? "#ef4444" : action === "PAUSE" ? "#f59e0b" : "#cbd5e1";

const AXIS = { fontSize: 11, fill: "#64748b" };
const TOOLTIP = {
  contentStyle: { borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 10px 30px -12px rgba(15,23,42,.25)", fontSize: 12 },
  labelStyle: { fontWeight: 600, color: "#0f172a" },
};

/** Weeks-of-cover bars for one perishability group, with its min/max window lines. */
export function CoverChart({
  rows,
  perishability,
  onSelect,
  selected,
  height = 240,
}: {
  rows: SkuResult[];
  perishability: "Low" | "High";
  onSelect: (sku: string) => void;
  selected: string | null;
  height?: number;
}) {
  const win = RULES.windows[perishability];
  const data = rows
    .filter((r) => r.perishability === perishability && r.weeksOfCover !== null)
    .map((r) => ({ sku: r.skuId.replace("SKU", ""), id: r.skuId, cover: +r.weeksOfCover!.toFixed(2), action: r.action, name: r.name }));
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-400">No {perishability}-perishability SKUs with cover.</p>;
  const yMax = Math.ceil(Math.max(win.max * 1.25, ...data.map((d) => d.cover)) + 1);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 44, left: -18, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="sku" tick={AXIS} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} interval={0} />
        <YAxis domain={[0, yMax]} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip
          {...TOOLTIP}
          cursor={{ fill: "#f8fafc" }}
          formatter={(v) => [`${v} weeks`, "Cover"]}
          labelFormatter={(_, p) => `${p?.[0]?.payload?.id ?? ""} · ${p?.[0]?.payload?.name ?? ""} · ${p?.[0]?.payload?.action ?? ""}`}
        />
        <ReferenceArea y1={win.min} y2={win.max} fill="#10b981" fillOpacity={0.06} />
        <ReferenceLine y={win.min} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `min ${win.min}`, position: "right", fontSize: 11, fill: "#ef4444" }} />
        <ReferenceLine y={win.max} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: `max ${win.max}`, position: "right", fontSize: 11, fill: "#d97706" }} />
        <Bar dataKey="cover" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d) => onSelect((d as unknown as { id: string }).id)}>
          {data.map((d) => (
            <Cell
              key={d.id}
              fill={ACTION_COLOR(d.action)}
              fillOpacity={selected && selected !== d.id ? 0.55 : 1}
              stroke={d.id === selected ? "#0f172a" : undefined}
              strokeWidth={d.id === selected ? 1.5 : 0}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 16-week sales line with 4-wk / 12-wk averages (dashed) and festival weeks shaded. */
export function TrendChart({ row }: { row: SkuResult }) {
  const h = row.history;
  const n = h.length;
  const data = h.map((p, i) => ({
    week: p.week.replace(/^\d{4}-/, ""),
    units: p.units,
    avg4: i >= n - RULES.shortWindow && row.avg4w !== null ? +row.avg4w.toFixed(1) : null,
    avg12: i >= n - RULES.longWindow && row.avg12w !== null ? +row.avg12w.toFixed(1) : null,
    festival: p.festival,
  }));
  const areas: { x1: string; x2: string }[] = [];
  data.forEach((d, i) => {
    if (!d.festival) return;
    if (i > 0 && data[i - 1].festival) areas[areas.length - 1].x2 = d.week;
    else areas.push({ x1: d.week, x2: d.week });
  });
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        {areas.map((a) => (
          <ReferenceArea key={a.x1} x1={a.x1} x2={a.x2} fill="#fbbf24" fillOpacity={0.14} label={{ value: "Festival month", position: "insideTop", fontSize: 11, fill: "#b45309" }} />
        ))}
        <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...TOOLTIP} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
        <Line type="monotone" dataKey="units" name="Units sold" stroke="#059669" strokeWidth={2.5} dot={{ r: 2.5, fill: "#059669" }} activeDot={{ r: 5 }} />
        <Line dataKey="avg4" name="4-wk avg" stroke="#ef4444" strokeWidth={1.75} strokeDasharray="6 4" dot={false} />
        <Line dataKey="avg12" name="12-wk avg" stroke="#64748b" strokeWidth={1.75} strokeDasharray="6 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
