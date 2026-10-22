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
  action.startsWith("REORDER") ? "#dc2626" : action === "PAUSE" ? "#d97706" : "#9ca3af";

/** Weeks-of-cover bars for one perishability group, with its min/max window lines. */
export function CoverChart({
  rows,
  perishability,
  onSelect,
  selected,
}: {
  rows: SkuResult[];
  perishability: "Low" | "High";
  onSelect: (sku: string) => void;
  selected: string | null;
}) {
  const win = RULES.windows[perishability];
  const data = rows
    .filter((r) => r.perishability === perishability && r.weeksOfCover !== null)
    .map((r) => ({ sku: r.skuId, cover: +r.weeksOfCover!.toFixed(2), action: r.action, name: r.name }));
  if (!data.length) return <p className="text-sm text-gray-500">No {perishability}-perishability SKUs with cover.</p>;
  const yMax = Math.ceil(Math.max(win.max * 1.25, ...data.map((d) => d.cover)) + 1);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-600">
        {perishability} perishability · window {win.min}–{win.max} wks
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 40, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="sku" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={50} />
          <YAxis domain={[0, yMax]} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v) => [`${v} wks`, "Weeks of cover"]}
            labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.name ?? ""} · ${p?.[0]?.payload?.action ?? ""}`}
          />
          <ReferenceLine y={win.min} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `min ${win.min}`, position: "right", fontSize: 11, fill: "#dc2626" }} />
          <ReferenceLine y={win.max} stroke="#d97706" strokeDasharray="4 4" label={{ value: `max ${win.max}`, position: "right", fontSize: 11, fill: "#d97706" }} />
          <Bar dataKey="cover" cursor="pointer" onClick={(d) => onSelect((d as unknown as { sku: string }).sku)}>
            {data.map((d) => (
              <Cell
                key={d.sku}
                fill={ACTION_COLOR(d.action)}
                stroke={d.sku === selected ? "#111827" : undefined}
                strokeWidth={d.sku === selected ? 2 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
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
  // Contiguous festival runs → shaded areas
  const areas: { x1: string; x2: string }[] = [];
  data.forEach((d, i) => {
    if (!d.festival) return;
    if (i > 0 && data[i - 1].festival) areas[areas.length - 1].x2 = d.week;
    else areas.push({ x1: d.week, x2: d.week });
  });
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        {areas.map((a) => (
          <ReferenceArea key={a.x1} x1={a.x1} x2={a.x2} fill="#fde68a" fillOpacity={0.45} label={{ value: "Festival month", position: "insideTop", fontSize: 11 }} />
        ))}
        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="units" name="Units sold" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
        <Line dataKey="avg4" name="4-wk avg" stroke="#dc2626" strokeDasharray="6 4" dot={false} connectNulls={false} />
        <Line dataKey="avg12" name="12-wk avg" stroke="#6b7280" strokeDasharray="6 4" dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
