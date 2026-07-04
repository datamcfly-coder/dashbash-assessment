import { getTeamSummary } from "@/lib/db";
import { apiError, json } from "@/lib/api";

// One team's last-7-days roll-up. 404 if the team has no agents.
// Next.js already URL-decodes the [name] segment, so "West%20Coast" arrives
// here as "West Coast" — we use it as-is (no second decode, which would corrupt
// a name that legitimately contains a '%').
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const summary = getTeamSummary(name);
  if (!summary) return apiError(404, "team_not_found", { name });
  return json(summary);
}
