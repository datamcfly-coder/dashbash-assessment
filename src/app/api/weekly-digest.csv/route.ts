import { digestToCsv, getWeeklyDigest } from "@/lib/db";

// Same daily data as /api/weekly-digest, shaped as a CSV the CS team drops into
// Google Sheets. Columns: date, connected_count, total_count, top_team,
// top_team_connects. Team names are RFC 4180-escaped in the data layer.
export const dynamic = "force-dynamic";

export function GET() {
  const csv = digestToCsv(getWeeklyDigest().data);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="weekly-digest.csv"',
      "Cache-Control": "no-store",
    },
  });
}
