/**
 * Admin Metrics API — Phase 1 of the metrics-consolidation plan.
 *
 *   GET /api/admin/metrics?range=24h|7d|30d|90d|ytd|all
 *
 * Single endpoint that powers every tile on the new Overview dashboard.
 * Returns the current value, the value from the prior period of the same
 * length (for delta arrows), and a sparkline-friendly array of buckets.
 *
 * Phase 1 shipped four seed metrics end-to-end. Phase 2 (this revision)
 * adds 11 more across five categories. Every metric reuses metricBundle so
 * adding the next one is a one-line append; the SQL filtering is the only
 * thing that varies. Categories — for the dashboard's panel groupings — are
 * encoded in the metric key prefix (revenue.*, counselor.*, students.*,
 * engagement.*, llm.*, ops.*).
 *
 * Full set:
 *   revenue.total_cents          SUM payments.amount_cents WHERE succeeded
 *   revenue.refund_cents         SUM payments.amount_cents WHERE refunded
 *   revenue.payment_count        COUNT succeeded payments
 *   counselor.payouts_cents      SUM counselor_payouts.amount_cents
 *   counselor.payout_count       COUNT counselor_payouts
 *   students.signups             COUNT users WHERE role='student'
 *   students.new_counselors      COUNT users WHERE role='counselor'
 *   engagement.colleges_added    COUNT colleges (per-student saves)
 *   engagement.essays_created    COUNT essay_drafts
 *   engagement.essays_submitted  COUNT essay_drafts WHERE status='submitted'
 *   llm.cost_microcents          SUM llm_usage.cost_microcents (÷1e6 = USD)
 *   llm.calls                    COUNT llm_usage rows
 *   llm.tokens                   SUM llm_usage.total_tokens
 *   ops.errors                   COUNT admin_logs WHERE level='error'
 *   ops.warnings                 COUNT admin_logs WHERE level='warn'
 *
 * Auth: admin only.
 *
 * Bucket sizing per range (drives sparkline granularity):
 *   24h → 1 hour    (24 points)
 *   7d  → 1 day     (7 points)
 *   30d → 1 day     (30 points)
 *   90d → 1 week    (~13 points)
 *   ytd → 1 week    (varies)
 *   all → 1 month   (varies)
 *
 * "Previous period" is the same-length window immediately before the current
 * one — e.g. for range=7d, current is the last 7 days, previous is the 7
 * days before that. For range=ytd, previous is the same number of days from
 * Jan 1 of the prior year (so a year-over-year comparison feels natural).
 * For range=all, previous is empty (0) so deltas are suppressed in the UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/auth-helpers';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Range = '24h' | '7d' | '30d' | '90d' | 'ytd' | 'all';
const VALID_RANGES = new Set<Range>(['24h', '7d', '30d', '90d', 'ytd', 'all']);

interface RangeWindow {
  since: Date;
  until: Date;
  prevSince: Date;
  prevUntil: Date;
  /**
   * Bucket label for the response, plus its date_trunc field. We use
   * date_trunc rather than date_bin because Postgres' date_bin rejects
   * month/year strides — date_trunc handles every granularity we need.
   */
  bucket: '1 hour' | '1 day' | '1 week' | '1 month';
  truncField: 'hour' | 'day' | 'week' | 'month';
  truncInterval: string; // matching INTERVAL string for generate_series
  /** True when the previous-period window is meaningful (false for 'all'). */
  hasPrevious: boolean;
}

/** Compute current and previous windows + the right sparkline bucket. */
function computeWindow(range: Range, now: Date): RangeWindow {
  const until = now;
  let since: Date;
  let bucket: RangeWindow['bucket'];
  let truncField: RangeWindow['truncField'];
  let truncInterval: string;
  let hasPrevious = true;

  switch (range) {
    case '24h':
      since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      bucket = '1 hour'; truncField = 'hour'; truncInterval = '1 hour';
      break;
    case '7d':
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      bucket = '1 day'; truncField = 'day'; truncInterval = '1 day';
      break;
    case '30d':
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      bucket = '1 day'; truncField = 'day'; truncInterval = '1 day';
      break;
    case '90d':
      since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      bucket = '1 week'; truncField = 'week'; truncInterval = '1 week';
      break;
    case 'ytd':
      since = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      bucket = '1 week'; truncField = 'week'; truncInterval = '1 week';
      break;
    case 'all':
    default:
      // Pick a far-past anchor; Admitly was created in 2024 so 2020-01-01 is
      // safely earlier than any real row.
      since = new Date(Date.UTC(2020, 0, 1));
      bucket = '1 month'; truncField = 'month'; truncInterval = '1 month';
      hasPrevious = false;
      break;
  }

  // Previous window. For YTD specifically we compare to Jan 1 → same calendar
  // day of last year so a YoY read feels right; otherwise we shift back by the
  // current window's own length.
  let prevSince: Date;
  let prevUntil: Date;
  if (range === 'ytd') {
    prevSince = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    prevUntil = new Date(Date.UTC(
      now.getUTCFullYear() - 1,
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(),
    ));
  } else {
    const lengthMs = until.getTime() - since.getTime();
    prevUntil = since;
    prevSince = new Date(since.getTime() - lengthMs);
  }

  return { since, until, prevSince, prevUntil, bucket, truncField, truncInterval, hasPrevious };
}

/**
 * Build a sparkline array for a metric.
 *
 * We let Postgres do the bucketing with date_trunc and join against a
 * generate_series so empty buckets show as 0 rather than missing entries.
 * date_trunc (rather than date_bin) is used because date_bin rejects
 * month/year strides, and we need '1 month' for range='all'.
 *
 * The caller passes a small SQL fragment that produces (created_at, value)
 * rows over the requested window — we handle the rest.
 */
async function metricBundle(opts: {
  pool: ReturnType<typeof getPool>;
  /**
   * SQL that returns rows with (created_at TIMESTAMP, value NUMERIC) over a
   * windowed-and-filtered slice of the source table. We do *not* aggregate
   * here — the wrapper does that per bucket and per period. Uses $1/$2 for
   * since/until.
   */
  rowsSql: string;
  /** Param values for rowsSql in addition to (since, until). */
  extraParams?: any[];
  win: RangeWindow;
}): Promise<{ current: number; previous: number; spark: number[] }> {
  const { pool, rowsSql, extraParams = [], win } = opts;

  // truncField is hard-coded into the SQL (not a parameter) because
  // date_trunc requires a literal. We've already validated `range` against
  // VALID_RANGES so truncField is one of four safe strings — no SQL injection
  // surface here.
  const tf = win.truncField;
  const ti = win.truncInterval;

  const currentSql = `SELECT COALESCE(SUM(value), 0) AS s FROM (${rowsSql}) t`;
  const previousSql = currentSql;
  const sparkSql = `
    WITH src AS (${rowsSql}),
    buckets AS (
      SELECT generate_series(
        date_trunc('${tf}', $1::timestamptz),
        date_trunc('${tf}', $2::timestamptz),
        INTERVAL '${ti}'
      ) AS b
    )
    SELECT b.b AS bucket,
           COALESCE(SUM(src.value), 0) AS v
      FROM buckets b
      LEFT JOIN src
        ON date_trunc('${tf}', src.created_at) = b.b
     GROUP BY b.b
     ORDER BY b.b ASC`;

  // PG error 42P01 = "undefined_table". Some Admitly tables (admin_logs,
  // counselor_payouts) are created lazily, so a fresh DB might not have
  // them yet — degrade to zeros instead of failing the whole dashboard.
  const safe = async <T,>(p: Promise<T>): Promise<T | null> => {
    try { return await p; }
    catch (e: any) {
      if (e?.code === '42P01') return null;
      throw e;
    }
  };

  const [curRes, prevRes, sparkRes] = await Promise.all([
    safe(pool.query(currentSql, [win.since, win.until, ...extraParams])),
    win.hasPrevious
      ? safe(pool.query(previousSql, [win.prevSince, win.prevUntil, ...extraParams]))
      : Promise.resolve({ rows: [{ s: 0 }] } as any),
    safe(pool.query(sparkSql, [win.since, win.until, ...extraParams])),
  ]);

  return {
    current: Number((curRes as any)?.rows[0]?.s ?? 0),
    previous: Number((prevRes as any)?.rows[0]?.s ?? 0),
    spark: ((sparkRes as any)?.rows ?? []).map((r: any) => Number(r.v ?? 0)),
  };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const rawRange = (searchParams.get('range') || '7d') as Range;
  const range: Range = VALID_RANGES.has(rawRange) ? rawRange : '7d';

  const now = new Date();
  const win = computeWindow(range, now);
  const pool = getPool();

  try {
    // Each metric is a small SELECT that returns (created_at, value). The
    // wrapper handles aggregation, period comparison, and sparkline bucketing
    // identically across metrics — the only thing that varies is *which*
    // events count and *what* their per-row value is. Defining metrics this
    // way means a category (revenue.*, llm.*, etc.) lives in just one place.
    const m = (rowsSql: string) => metricBundle({ pool, win, rowsSql });

    const [
      revenue, refunds, paymentCount,
      payouts, payoutCount,
      signups, newCounselors,
      collegesAdded, essaysCreated, essaysSubmitted,
      llmCost, llmCalls, llmTokens,
      opsErrors, opsWarnings,
    ] = await Promise.all([
      // Revenue & Payments
      m(`SELECT created_at, amount_cents AS value FROM payments
          WHERE status='succeeded' AND created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, amount_cents AS value FROM payments
          WHERE status='refunded' AND created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, 1 AS value FROM payments
          WHERE status='succeeded' AND created_at >= $1 AND created_at < $2`),
      // Counselor Earnings — counselor_payouts is the source of truth for
      // money paid out; we use created_at as the event time so the spark
      // matches "when was the payout recorded" rather than "when did the
      // bank settle".
      m(`SELECT created_at, amount_cents AS value FROM counselor_payouts
          WHERE created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, 1 AS value FROM counselor_payouts
          WHERE created_at >= $1 AND created_at < $2`),
      // Students & roles
      m(`SELECT created_at, 1 AS value FROM users
          WHERE role='student' AND created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, 1 AS value FROM users
          WHERE role='counselor' AND created_at >= $1 AND created_at < $2`),
      // Engagement
      m(`SELECT created_at, 1 AS value FROM colleges
          WHERE created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, 1 AS value FROM essay_drafts
          WHERE created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, 1 AS value FROM essay_drafts
          WHERE status='submitted' AND created_at >= $1 AND created_at < $2`),
      // LLM
      m(`SELECT created_at, cost_microcents AS value FROM llm_usage
          WHERE created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, 1 AS value FROM llm_usage
          WHERE created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, total_tokens AS value FROM llm_usage
          WHERE created_at >= $1 AND created_at < $2`),
      // Ops — admin_logs gets created lazily; if it doesn't exist yet,
      // metricBundle will throw and the route will 500. We tolerate that
      // by catching at the Promise.all level (see below).
      m(`SELECT created_at, 1 AS value FROM admin_logs
          WHERE level='error' AND created_at >= $1 AND created_at < $2`),
      m(`SELECT created_at, 1 AS value FROM admin_logs
          WHERE level='warn' AND created_at >= $1 AND created_at < $2`),
    ]);

    return NextResponse.json({
      range,
      since: win.since.toISOString(),
      until: win.until.toISOString(),
      previous_since: win.hasPrevious ? win.prevSince.toISOString() : null,
      previous_until: win.hasPrevious ? win.prevUntil.toISOString() : null,
      bucket: win.bucket,
      metrics: {
        'revenue.total_cents':         revenue,
        'revenue.refund_cents':        refunds,
        'revenue.payment_count':       paymentCount,
        'counselor.payouts_cents':     payouts,
        'counselor.payout_count':      payoutCount,
        'students.signups':            signups,
        'students.new_counselors':     newCounselors,
        'engagement.colleges_added':   collegesAdded,
        'engagement.essays_created':   essaysCreated,
        'engagement.essays_submitted': essaysSubmitted,
        // cost_microcents → callers divide by 1_000_000 for USD.
        'llm.cost_microcents':         llmCost,
        'llm.calls':                   llmCalls,
        'llm.tokens':                  llmTokens,
        'ops.errors':                  opsErrors,
        'ops.warnings':                opsWarnings,
      },
    });
  } catch (err: any) {
    console.error('[admin/metrics] failed:', err);
    return NextResponse.json(
      { error: 'Failed to compute metrics', detail: err?.message },
      { status: 500 },
    );
  }
}
