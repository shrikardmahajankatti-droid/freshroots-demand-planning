"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, CalendarDays, ChevronRight, Cloud, CloudOff, Database, LayoutDashboard, Leaf, ListChecks, Menu, Play, Sparkles, Truck, UploadCloud, UserCheck, X } from "lucide-react";
import { BoxLabelContext, Button, Chip, Toasts } from "@/components/ui";
import { WsContext, monthName, ts, useWorkspaceState, useWs, type Tab, type Workspace } from "@/components/workspace";
import { ActionList } from "@/components/views/ActionList";
import { Calendar } from "@/components/views/Calendar";
import { DataSources } from "@/components/views/DataSources";
import { Exceptions } from "@/components/views/Exceptions";
import { Overview } from "@/components/views/Overview";
import { PurchaseOrders } from "@/components/views/PurchaseOrders";
import { RulesSettings } from "@/components/views/RulesSettings";
import { SkuDrawer } from "@/components/views/SkuDrawer";
import { UploadDialog } from "@/components/views/UploadDialog";

interface NavItem {
  id: Tab;
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
}

function navItems(ws: Workspace): { outputs: NavItem[]; configure: NavItem[] } {
  const open = ws.g1.total - ws.g1.resolved;
  return {
    outputs: [
      { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
      {
        id: "exceptions",
        label: "Exceptions",
        icon: <UserCheck className="h-4 w-4" />,
        badge: ws.run ? (open ? <Badge tone="violet">{open}</Badge> : <Badge tone="green">✓</Badge>) : undefined,
      },
      { id: "actions", label: "Action list", icon: <ListChecks className="h-4 w-4" />, badge: ws.run ? <Badge>{ws.rows.length}</Badge> : undefined },
      {
        id: "orders",
        label: "Purchase orders",
        icon: <Truck className="h-4 w-4" />,
        badge: ws.run
          ? ws.hubspot.state === "done"
            ? <Badge tone="green">In HubSpot</Badge>
            : ws.g2
              ? <Badge tone="green">Signed</Badge>
              : ws.g1.complete
                ? <Badge tone="amber">Ready</Badge>
                : <Badge>Draft</Badge>
          : undefined,
      },
      { id: "calendar", label: "PO calendar", icon: <CalendarDays className="h-4 w-4" /> },
    ],
    configure: [
      { id: "rules", label: "Rules & settings", icon: <BookOpen className="h-4 w-4" />, badge: ws.stats.killCriterion ? <Badge tone="red">Kill switch</Badge> : undefined },
      {
        id: "data",
        label: "Data sources",
        icon: <Database className="h-4 w-4" />,
        badge: Object.values(ws.files).some((f) => f?.error) ? <Badge tone="red">Error</Badge> : ws.allLoaded ? <Badge tone="green">5/5</Badge> : undefined,
      },
    ],
  };
}

const TITLES: Record<Tab, string> = {
  overview: "Overview",
  exceptions: "Exceptions review",
  actions: "Action list",
  orders: "Purchase orders",
  calendar: "PO calendar",
  rules: "Rules & settings",
  data: "Data sources",
};

export default function Page() {
  const ws = useWorkspaceState();
  const [navOpen, setNavOpen] = useState(false);
  const nav = navItems(ws);
  const { setUploadOpen } = ws;

  // Dragging files anywhere onto the window opens the upload dialog; a stray drop never navigates away.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => hasFiles(e) && setUploadOpen(true);
    const block = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, [setUploadOpen]);

  const go = (t: Tab) => {
    ws.setTab(t);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <WsContext.Provider value={{ ...ws, setTab: go }}>
      <BoxLabelContext.Provider value={ws.showBoxes}>
        <div className="min-h-screen bg-slate-50 text-slate-900">
          {/* Sidebar */}
          <div className={`fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm transition-opacity lg:hidden ${navOpen ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => setNavOpen(false)} />
          <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-slate-950 text-slate-300 transition-transform duration-300 lg:w-64 lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
            <div className="flex h-16 items-center justify-between gap-2 px-5">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/20">
                  <Leaf className="h-4 w-4" />
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-white">Freshroots</p>
                  <p className="text-[11px] text-slate-400">Demand Planner</p>
                </div>
              </div>
              <button className="text-slate-400 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mx-4 mb-5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Workspace</p>
              <p className="truncate text-sm font-medium text-slate-200">Pune Central Warehouse</p>
              <p className="text-[11px] text-slate-500">{monthName(ws.dataset?.asOfMonth)} · {ws.isDemo ? "demo data" : "uploaded data"}</p>
            </div>

            <nav className="flex-1 space-y-6 overflow-y-auto px-3">
              <NavGroup title="Outputs" items={nav.outputs} active={ws.tab} onGo={go} />
              <NavGroup title="Configure" items={nav.configure} active={ws.tab} onGo={go} />
            </nav>

            <div className="space-y-3 border-t border-white/5 p-4">
              <DbChip />
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
                <Sparkles className="h-3.5 w-3.5" />
                {ws.explStatus?.source === "ai" ? "Gemini explanations on" : "Template reasons · no AI"}
              </div>
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-sm font-semibold text-white">
                  {(ws.g1Name.trim()[0] ?? "R").toUpperCase()}
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-medium text-white">{ws.g1Name || "Planner"}</p>
                  <p className="text-[11px] text-slate-500">Senior Demand Planner</p>
                </div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <div className="lg:pl-64">
            <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
              <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
                <button className="-ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </button>
                <nav className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
                  <span className="hidden sm:inline">{monthName(ws.dataset?.asOfMonth)} cycle</span>
                  <ChevronRight className="hidden h-3.5 w-3.5 sm:inline" />
                  <span className="truncate font-semibold text-slate-900">{TITLES[ws.tab]}</span>
                </nav>
                <div className="ml-auto flex items-center gap-2">
                  {ws.run && <span className="hidden text-xs text-slate-500 md:inline">Last run {ts(ws.run.at)}</span>}
                  {ws.fest && (
                    <span className="hidden lg:inline-flex">
                      <Chip tone={ws.fest.on ? "green" : "slate"} dot>Uplift {ws.fest.on ? "ON" : "OFF"}</Chip>
                    </span>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => ws.setUploadOpen(true)}>
                    <UploadCloud className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Upload new data</span>
                    <span className="sm:hidden">Upload</span>
                  </Button>
                  <Button size="sm" onClick={ws.runForecast} disabled={!ws.allLoaded}>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span className="hidden sm:inline">{ws.run ? "Re-run" : "Run forecast"}</span>
                    <span className="sm:hidden">Run</span>
                  </Button>
                </div>
              </div>
              {/* Mobile tabs */}
              <div className="overflow-x-auto border-t border-slate-100 px-2 lg:hidden">
                <div className="flex w-max gap-1 py-1.5">
                  {[...nav.outputs, ...nav.configure].map((n) => (
                    <button
                      key={n.id}
                      onClick={() => go(n.id)}
                      className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium ${ws.tab === n.id ? "bg-slate-900 text-white" : "text-slate-600"}`}
                    >
                      {n.label}
                      {n.badge}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
              {ws.tab === "overview" && <Overview />}
              {ws.tab === "exceptions" && <Exceptions />}
              {ws.tab === "actions" && <ActionList />}
              {ws.tab === "orders" && <PurchaseOrders />}
              {ws.tab === "calendar" && <Calendar />}
              {ws.tab === "rules" && <RulesSettings />}
              {ws.tab === "data" && <DataSources />}
              <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-slate-400">
                <span>Freshroots Demand Planner · {ws.dbStatus.state === "ok" ? "saved in Neon Postgres" : "not saved — state lives in this browser tab"}</span>
                <span>Rules run in code · AI explains · humans decide</span>
              </footer>
            </main>
          </div>

          <SkuDrawer />
          <UploadDialog />
          <Toasts items={ws.toasts} onDismiss={ws.dismissToast} />
        </div>
      </BoxLabelContext.Provider>
    </WsContext.Provider>
  );
}

function DbChip() {
  const { dbStatus, setTab } = useWs();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const ago = (iso: string) => {
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    return s < 45 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : ts(iso);
  };
  const [cls, Icon, text] =
    dbStatus.state === "ok"
      ? ["bg-sky-500/10 text-sky-300 ring-sky-500/20", Cloud, dbStatus.saving ? "Saving to Neon…" : dbStatus.savedAt ? `Saved to Neon · ${ago(dbStatus.savedAt)}` : "Connected to Neon"]
      : dbStatus.state === "error"
        ? ["bg-red-500/10 text-red-300 ring-red-500/20", CloudOff, "Neon unavailable · not saving"]
        : dbStatus.state === "off"
          ? ["bg-white/5 text-slate-400 ring-white/10", CloudOff, "No database · not saved"]
          : ["bg-white/5 text-slate-400 ring-white/10", Cloud, "Connecting to Neon…"];
  return (
    <button onClick={() => setTab("data")} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ring-1 ring-inset ${cls}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </button>
  );
}

function NavGroup({ title, items, active, onGo }: { title: string; items: NavItem[]; active: Tab; onGo: (t: Tab) => void }) {
  return (
    <div>
      <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <ul className="space-y-0.5">
        {items.map((n) => (
          <li key={n.id}>
            <button
              onClick={() => onGo(n.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                active === n.id ? "bg-white/10 font-medium text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className={active === n.id ? "text-emerald-400" : ""}>{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {n.badge}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small count/status pill. Works on the dark sidebar and the light mobile tab strip. */
function Badge({ tone = "slate", children }: { tone?: "slate" | "violet" | "green" | "amber" | "red"; children: ReactNode }) {
  const cls = {
    slate: "bg-slate-500/20 text-slate-500 lg:text-slate-300",
    violet: "bg-violet-500 text-white",
    green: "bg-emerald-500/20 text-emerald-600 lg:text-emerald-300",
    amber: "bg-amber-400/25 text-amber-700 lg:text-amber-300",
    red: "bg-red-500 text-white",
  }[tone];
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${cls}`}>{children}</span>;
}
