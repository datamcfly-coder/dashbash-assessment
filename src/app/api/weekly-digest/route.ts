import { getWeeklyDigest } from "@/lib/db";
import { json } from "@/lib/api";

// Last 28 days of overall activity + the top 3 agents this week. See README.
export const dynamic = "force-dynamic";

export function GET() {
  return json(getWeeklyDigest());
}
