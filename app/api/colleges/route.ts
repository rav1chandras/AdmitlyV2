import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isPro } from '@/lib/subscription';
import { getColleges, addCollege, updateCollege, deleteCollege, getMasterCollegeById, searchMasterCollegesDB } from '@/lib/db';
import { determineBucket } from '@/lib/masterData';
import { ensureCollegesMaster } from '@/lib/seed-colleges';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPro(session)) return NextResponse.json({ error: 'Pro subscription required', upgrade: true }, { status: 403 });

    await ensureCollegesMaster();

    const colleges = await getColleges(parseInt(session.user.id));

    // Enrich with master data from DB
    const enriched = await Promise.all(
      colleges.map(async (c) => {
        if (c.master_id) {
          const master = await getMasterCollegeById(c.master_id);
          if (master) {
            return {
              ...c,
              name:            master.name,
              city:            master.city,
              state:           master.state,
              ownership:       master.ownership,
              sat_range:       master.sat_range,
              sat_25:          master.sat_25,
              sat_75:          master.sat_75,
              sat_math_25:     master.sat_math_25,
              sat_math_75:     master.sat_math_75,
              sat_cr_25:       master.sat_cr_25,
              sat_cr_75:       master.sat_cr_75,
              sat_avg:         master.sat_avg ?? 0,
              act_range:       master.act_range,
              accept_rate:     master.acceptance_rate,
              grad_rate:       master.grad_rate,
              tuition_in:      String(master.tuition_in_state ?? ''),
              tuition_out:     String(master.tuition_out_state ?? ''),
              net_price:       master.net_price,
              cost_attendance: master.cost_attendance,
              earnings_6yr:    master.earnings_6yr,
              earnings_10yr:   master.earnings_10yr,
              enrollment:      master.enrollment,
              retention_rate:  master.retention_rate,
              student_faculty_ratio: master.student_faculty_ratio,
              median_debt:     master.median_debt,
              pell_rate:       master.pell_rate,
              pct_white:       master.pct_white,
              pct_black:       master.pct_black,
              pct_hispanic:    master.pct_hispanic,
              pct_asian:       master.pct_asian,
              pct_two_or_more: master.pct_two_or_more,
              pct_men:         master.pct_men,
              pct_women:       master.pct_women,
              college_url:     master.college_url,
            };
          }
        }
        return c;
      })
    );

    console.log('[Colleges GET] Returning', enriched.length, 'colleges');
    return NextResponse.json(enriched);
  } catch (error) {
    console.error('[Colleges GET] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPro(session)) return NextResponse.json({ error: 'Pro subscription required', upgrade: true }, { status: 403 });

    const data = await request.json();

    // Resolve master row from DB
    let master_id: number | null = data.master_id ? Number(data.master_id) : null;
    let masterRow = master_id ? await getMasterCollegeById(master_id) : null;

    if (!masterRow && data.name) {
      const matches = await searchMasterCollegesDB(data.name, 1);
      if (matches.length > 0 && matches[0].name.toLowerCase() === data.name.toLowerCase()) {
        masterRow = matches[0];
        master_id = masterRow.ope6_id;
      }
    }

    const acceptRate = Math.round(Number(masterRow ? (masterRow.acceptance_rate ?? 50) : (data.accept_rate ?? 50)));
    const bucket = (data.bucket && ['reach', 'target', 'safety'].includes(data.bucket))
      ? data.bucket
      : determineBucket(acceptRate);

    const college = await addCollege(parseInt(session.user.id), {
      name:        masterRow?.name ?? data.name,
      master_id,
      bucket:      bucket as 'reach' | 'target' | 'safety',
      accept_rate: acceptRate,
      grad_rate:   Math.round(Number(masterRow?.grad_rate ?? data.grad_rate ?? 80)),
      sat_avg:     0,
      sat_range:   masterRow?.sat_range ?? (data.sat_range || 'N/A'),
      act_range:   masterRow?.act_range ?? (data.act_range || 'N/A'),
      tuition_in:  masterRow ? String(masterRow.tuition_in_state ?? '') : (data.tuition_in || 'N/A'),
      tuition_out: masterRow ? String(masterRow.tuition_out_state ?? '') : (data.tuition_out || 'N/A'),
      notes:       data.notes || '',
    });

    if (!college) return NextResponse.json({ error: 'Failed to add college' }, { status: 500 });

    if (masterRow) {
      return NextResponse.json({
        ...college,
        city:            masterRow.city,
        state:           masterRow.state,
        ownership:       masterRow.ownership,
        sat_range:       masterRow.sat_range,
        sat_25:          masterRow.sat_25,
        sat_75:          masterRow.sat_75,
        sat_avg:         masterRow.sat_avg ?? 0,
        act_range:       masterRow.act_range,
        accept_rate:     masterRow.acceptance_rate,
        grad_rate:       masterRow.grad_rate,
        tuition_in:      String(masterRow.tuition_in_state ?? ''),
        tuition_out:     String(masterRow.tuition_out_state ?? ''),
        net_price:       masterRow.net_price,
        earnings_6yr:    masterRow.earnings_6yr,
        earnings_10yr:   masterRow.earnings_10yr,
        enrollment:      masterRow.enrollment,
        retention_rate:  masterRow.retention_rate,
        student_faculty_ratio: masterRow.student_faculty_ratio,
        median_debt:     masterRow.median_debt,
        pell_rate:       masterRow.pell_rate,
        pct_white:       masterRow.pct_white,
        pct_black:       masterRow.pct_black,
        pct_hispanic:    masterRow.pct_hispanic,
        pct_asian:       masterRow.pct_asian,
        pct_two_or_more: masterRow.pct_two_or_more,
        pct_men:         masterRow.pct_men,
        pct_women:       masterRow.pct_women,
      });
    }

    return NextResponse.json(college);
  } catch (error) {
    console.error('[Colleges POST] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, ...data } = await request.json();
    const college = await updateCollege(id, parseInt(session.user.id), data);

    if (!college) return NextResponse.json({ error: 'Failed to update college' }, { status: 500 });
    return NextResponse.json(college);
  } catch (error) {
    console.error('[Colleges PUT] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      // Single delete
      await deleteCollege(parseInt(id), parseInt(session.user.id));
    } else {
      // Bulk delete all colleges for this user
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.POSTGRES_URL, max: 3 });
      await pool.query('DELETE FROM colleges WHERE user_id = $1', [parseInt(session.user.id)]);
      await pool.end();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Colleges DELETE] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}