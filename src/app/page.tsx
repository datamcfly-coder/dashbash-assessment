import Image from "next/image";
import { AlertTriangle, PhoneCall, Sparkles, TrendingUp, Users } from "lucide-react";

import {
  agentsImproving,
  agentsNeedingAttention,
  getDashboard,
  type AgentTrend,
} from "@/lib/db";
import { num, pct, pp, signedInt } from "@/lib/format";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { TrendBadge } from "@/components/dashboard/TrendBadge";

// Always render fresh: every number on this page is a live query. Nothing here
// is cached or pre-rendered, so Dana never looks at a stale figure.
export const dynamic = "force-dynamic";

// --- What this dashboard answers -------------------------------------------
// Dana asked for two things, not a spreadsheet:
//   1. Week to week, are my agents getting better or worse?
//   2. Who should I be talking to on Monday morning?
// So the page leads with the Monday number, then a short *ranked action list*
// of who to talk to, then team and per-agent week-over-week trends. Everything
// is framed as "this week vs last week" because that's the question she asks.

function formatAsOf(iso: string): string {
  // Deterministic UTC label so the server and the seed agree on "today".
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function Page() {
  const dash = getDashboard();
  const attention = agentsNeedingAttention(dash.agents);
  const improving = agentsImproving(dash.agents);
  const connectedDelta = dash.connected_7 - dash.connected_prior_7;

  // Everyone, busiest first — the "I still want to see the whole floor" view.
  const roster = [...dash.agents].sort((a, b) => b.connected_7 - a.connected_7);

  return (
    <div className="min-h-screen">
      <Header asOf={formatAsOf(dash.generated_at)} />

      <main className="mx-auto max-w-content space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        {/* ---- The Monday number + overall direction ---- */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="p-5 sm:col-span-2 sm:p-6">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
              <PhoneCall className="h-4 w-4 text-accent" aria-hidden />
              Connected calls · last 7 days
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
              <span className="font-mono text-5xl font-semibold leading-none tabular-nums sm:text-6xl">
                {num(dash.connected_7)}
              </span>
              <span
                className={
                  "mb-1 text-sm font-medium " +
                  (connectedDelta >= 0 ? "text-success" : "text-warning")
                }
              >
                {signedInt(connectedDelta)} vs prior 7 days
              </span>
            </div>
            <p className="mt-3 text-sm text-muted">
              {num(dash.connected_prior_7)} connected the week before. This is the number Dana
              checks every Monday — live from the database.
            </p>
          </Card>

          <Card className="flex flex-col justify-between p-5 sm:p-6">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
              <TrendingUp className="h-4 w-4 text-accent" aria-hidden />
              Team connect rate
            </div>
            <div className="mt-3">
              <span className="font-mono text-4xl font-semibold tabular-nums">
                {pct(dash.rate_7)}
              </span>
              <div className="mt-2">
                <TrendBadge delta={dash.rate_7 - dash.rate_prior_7} />
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">
              {num(dash.connected_7)} of {num(dash.total_7)} calls connected. Was{" "}
              {pct(dash.rate_prior_7)} last week.
            </p>
          </Card>
        </section>

        {/* ---- Who to talk to on Monday ---- */}
        <section>
          <SectionHeading
            icon={<AlertTriangle className="h-4 w-4 text-warning" aria-hidden />}
            title="Talk to these on Monday"
            subtitle="Ranked by who moved the most, week over week. Volume-gated so a slow day doesn't raise a false alarm."
          />

          {attention.length === 0 ? (
            <Card className="p-5 text-sm text-muted sm:p-6">
              No one dropped meaningfully this week. Connect rates held steady or improved across
              the floor.
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {attention.map((item) => (
                <AttentionCard key={item.agent.id} agent={item.agent} reason={item.reason} />
              ))}
            </div>
          )}

          {improving.length > 0 && (
            <Card className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 p-4 text-sm">
              <Sparkles className="h-4 w-4 shrink-0 text-success" aria-hidden />
              <span className="text-muted">Worth a shout-out:</span>
              {improving.map((a, i) => (
                <span key={a.id} className="font-medium">
                  {a.name}
                  <span className="ml-1 text-success">{pp(a.rate_delta)}</span>
                  {i < improving.length - 1 ? "," : ""}
                </span>
              ))}
            </Card>
          )}
        </section>

        {/* ---- Team trends ---- */}
        <section>
          <SectionHeading
            icon={<Users className="h-4 w-4 text-accent" aria-hidden />}
            title="Teams this week"
            subtitle="Connect rate vs last week."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {dash.teams.map((t) => (
              <Card key={t.team} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.team}</div>
                    <div className="text-xs text-muted">{t.agent_count} agents</div>
                  </div>
                  <TrendBadge delta={t.rate_delta} />
                </div>
                <div className="mt-3 font-mono text-2xl font-semibold tabular-nums">
                  {pct(t.rate_7)}
                </div>
                <div className="text-xs text-muted">
                  {num(t.connected_7)} connected · {num(t.total_7)} calls
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* ---- Full roster ---- */}
        <section>
          <SectionHeading
            icon={<PhoneCall className="h-4 w-4 text-accent" aria-hidden />}
            title="Every agent"
            subtitle="Last 7 days, busiest first. The mini-chart is connected calls per day over the last two weeks."
          />
          <Card className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="hidden sm:table-cell">Team</TableHead>
                  <TableHead className="text-right">Connected</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">WoW</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">14-day</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      {a.name}
                      <span className="block text-xs text-muted sm:hidden">{a.team}</span>
                    </TableCell>
                    <TableCell className="hidden text-muted sm:table-cell">{a.team}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {num(a.connected_7)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {a.total_7 === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        pct(a.rate_7)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.total_7 === 0 && a.total_prior_7 === 0 ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <TrendBadge delta={a.rate_delta} />
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <div className="flex justify-end text-accent">
                        <Sparkline values={a.daily_connected} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>

        <footer className="pt-2 text-center text-xs text-muted">
          Live from the ArmorHQ dialer database · times in UTC ·{" "}
          <a href="/api/weekly-digest" className="underline hover:text-foreground">
            weekly digest API
          </a>
        </footer>
      </main>
    </div>
  );
}

function Header({ asOf }: { asOf: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-content items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          {/* The logo art is black; the app is dark, so invert it to white. */}
          <Image
            src="/logo.png"
            alt="ArmorHQ"
            width={251}
            height={61}
            priority
            className="h-6 w-auto invert sm:h-7"
          />
          <span className="hidden text-sm text-muted sm:inline">Sales Performance</span>
        </div>
        <span className="text-xs text-muted sm:text-sm">Updated {asOf}</span>
      </div>
    </header>
  );
}

function SectionHeading({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

function AttentionCard({
  agent,
  reason,
}: {
  agent: AgentTrend;
  reason: "declining" | "quiet";
}) {
  const accent = reason === "declining" ? "border-l-warning" : "border-l-muted";
  return (
    <Card className={"border-l-2 p-4 " + accent}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{agent.name}</div>
          <div className="text-xs text-muted">{agent.team}</div>
        </div>
        <div className="text-accent">
          <Sparkline values={agent.daily_connected} width={72} height={24} />
        </div>
      </div>
      <p className="mt-3 text-sm">
        {reason === "quiet" ? (
          <>
            <span className="text-muted">Went quiet — </span>
            <span className="font-medium">no calls logged this week</span>
            <span className="text-muted"> (was {num(agent.total_prior_7)} last week).</span>
          </>
        ) : (
          <>
            <span className="text-muted">Connect rate </span>
            <span className="font-medium text-warning">{pp(agent.rate_delta)}</span>
            <span className="text-muted">
              {" "}
              — {pct(agent.rate_prior_7)} → {pct(agent.rate_7)} on {num(agent.total_7)} calls.
            </span>
          </>
        )}
      </p>
    </Card>
  );
}
