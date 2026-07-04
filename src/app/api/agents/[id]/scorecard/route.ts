import { getAgentScorecard } from "@/lib/db";
import { apiError, json } from "@/lib/api";

// One agent's last 14 days + week-over-week totals. 404 if the id is unknown.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scorecard = getAgentScorecard(id);
  if (!scorecard) return apiError(404, "agent_not_found", { id });
  return json(scorecard);
}
