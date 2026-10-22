"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import CountUp from "@/components/reactbits/CountUp/CountUp";
import SpotlightCard from "@/components/reactbits/SpotlightCard/SpotlightCard";
import { isReorder } from "@/lib/rules";

export type Tone = "red" | "amber" | "green" | "violet" | "slate" | "blue";

const TONE: Record<Tone, { chip: string; soft: string; dot: string; text: string }> = {
  red: { chip: "bg-red-50 text-red-700 ring-red-600/15", soft: "bg-red-50 border-red-200 text-red-800", dot: "bg-red-500", text: "text-red-600" },
  amber: { chip: "bg-amber-50 text-amber-800 ring-amber-600/20", soft: "bg-amber-50 border-amber-200 text-amber-900", dot: "bg-amber-500", text: "text-amber-600" },
  green: { chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", soft: "bg-emerald-50 border-emerald-200 text-emerald-900", dot: "bg-emerald-500", text: "text-emerald-600" },
  violet: { chip: "bg-violet-50 text-violet-700 ring-violet-600/20", soft: "bg-violet-50 border-violet-200 text-violet-900", dot: "bg-violet-500", text: "text-violet-600" },
  slate: { chip: "bg-slate-100 text-slate-700 ring-slate-500/15", soft: "bg-slate-50 border-slate-200 text-slate-700", dot: "bg-slate-400", text: "text-slate-500" },
  blue: { chip: "bg-sky-50 text-sky-700 ring-sky-600/20", soft: "bg-sky-50 border-sky-200 text-sky-900", dot: "bg-sky-500", text: "text-sky-600" },
};

export function Chip({ tone = "slate", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone].chip}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONE[tone].dot}`} />}
      {children}
    </span>
  );
}

export const actionTone = (action: string): Tone => (isReorder(action) ? "red" : action === "PAUSE" ? "amber" : "slate");

export function ActionBadge({ action }: { action: string }) {
  return (
    <Chip tone={actionTone(action)} dot>
      {action}
    </Chip>
  );
}

export function Callout({ tone, icon = true, children }: { tone: Tone; icon?: boolean; children: ReactNode }) {
  const Icon = tone === "green" ? CheckCircle2 : tone === "red" || tone === "amber" ? TriangleAlert : Info;
  return (
    <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-relaxed ${TONE[tone].soft}`}>
      {icon && <Icon className="mt-px h-3.5 w-3.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

/** Section card labelled with its box number from the component map. */
export function BoxCard({
  n,
  name,
  hint,
  icon,
  right,
  children,
  className = "",
}: {
  n: number | string;
  name: string;
  hint?: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={`box-${n}`} className={`min-w-0 scroll-mt-20 rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-start gap-3">
          {icon && <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10">{icon}</div>}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Box {n}</p>
            <h2 className="text-[15px] font-semibold text-slate-900">{name}</h2>
            {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
          </div>
        </div>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "dark" | "violet"; size?: "sm" | "md" | "lg" }) {
  const v = {
    primary: "bg-emerald-600 text-white shadow-sm shadow-emerald-900/10 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
    dark: "bg-slate-900 text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400",
    violet: "bg-violet-600 text-white shadow-sm hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400",
    secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-300 disabled:ring-slate-200",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300",
  }[variant];
  const s = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-sm gap-2" }[size];
  return (
    <button
      className={`inline-flex items-center justify-center rounded-xl font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed ${v} ${s} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** KPI tile: SpotlightCard surface + CountUp number. */
export function Kpi({
  label,
  value,
  suffix,
  sub,
  icon,
  tone = "slate",
  text,
}: {
  label: string;
  value?: number;
  suffix?: string;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  /** Non-numeric value (e.g. ON / OFF). */
  text?: string;
}) {
  return (
    <SpotlightCard theme="light" spotlightColor="#10b981" intensity={0.9} className="!rounded-2xl !p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {icon && <span className={TONE[tone].text}>{icon}</span>}
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
        {text ?? <CountUp to={value ?? 0} duration={1.1} separator="," trigger="load" />}
        {suffix && <span className="ml-1 text-sm font-medium text-slate-400">{suffix}</span>}
      </p>
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
    </SpotlightCard>
  );
}

export function StatRow({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`whitespace-nowrap font-semibold tabular-nums ${tone ? TONE[tone].text : "text-slate-900"}`}>{value}</span>
    </div>
  );
}

// ---- Toasts ---------------------------------------------------------------

export interface ToastMsg {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

export function Toasts({ items, onDismiss }: { items: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <ToastItem key={t.id} t={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ t, onDismiss }: { t: ToastMsg; onDismiss: (id: number) => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const a = requestAnimationFrame(() => setShown(true));
    const b = setTimeout(() => onDismiss(t.id), 4200);
    return () => {
      cancelAnimationFrame(a);
      clearTimeout(b);
    };
  }, [t.id, onDismiss]);
  const Icon = t.tone === "green" ? CheckCircle2 : t.tone === "red" || t.tone === "amber" ? TriangleAlert : Info;
  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg shadow-slate-900/10 transition-all duration-300 ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE[t.tone].text}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{t.title}</p>
        {t.body && <p className="mt-0.5 text-xs text-slate-500">{t.body}</p>}
      </div>
      <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
