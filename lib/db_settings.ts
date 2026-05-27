import { Pool } from 'pg';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    const cs = process.env.POSTGRES_URL;
    if (!cs) throw new Error('POSTGRES_URL not set');
    pool = new Pool({ connectionString: cs, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  }
  return pool;
}

export interface StudentSettings {
  id?: number;
  user_id?: number;
  // Personal
  phone: string;
  parent_email: string;
  bio: string;
  // Academic
  high_school_name: string;
  high_school_city: string;
  high_school_state: string;
  graduation_year: number | null;
  intended_major: string;
  intended_major_alt: string;
  gpa_scale: string;
  // Counselor
  counselor_name: string;
  counselor_email: string;
  // App prefs
  app_round: string;
  target_school_count: number;
  preferred_location: string;
  preferred_size: string;
  financial_aid_needed: boolean;
  // Notifications / opt-outs
  email_reminders: boolean;
  deadline_alerts: boolean;
  weekly_summary: boolean;
  share_data_analytics: boolean;
  allow_counselor_access: boolean;
}

export const SETTINGS_DEFAULTS: StudentSettings = {
  phone: '', parent_email: '', bio: '',
  high_school_name: '', high_school_city: '', high_school_state: '',
  graduation_year: null, intended_major: '', intended_major_alt: '',
  gpa_scale: '4.0', counselor_name: '', counselor_email: '',
  app_round: 'Regular Decision', target_school_count: 8,
  preferred_location: '', preferred_size: '',
  financial_aid_needed: false, email_reminders: true,
  deadline_alerts: true, weekly_summary: false,
  share_data_analytics: true, allow_counselor_access: true,
};

export async function getSettings(userId: number): Promise<StudentSettings | null> {
  const db = getPool();
  const res = await db.query('SELECT * FROM student_settings WHERE user_id = $1', [userId]);
  return res.rows[0] ?? null;
}

export async function upsertSettings(userId: number, data: Partial<StudentSettings>): Promise<StudentSettings> {
  const db = getPool();
  // Defensive coercion — graduation_year must be int or null, booleans must be actual booleans
  const gradYearRaw = data.graduation_year ? parseInt(String(data.graduation_year)) : null;
  const gradYear = gradYearRaw && !isNaN(gradYearRaw) ? gradYearRaw : null;
  const targetCount = parseInt(String(data.target_school_count)) || 8;
  const toBool = (v: unknown) => v === true || v === 'true' || v === 1;
  const res = await db.query(
    `INSERT INTO student_settings (
       user_id, phone, parent_email, bio,
       high_school_name, high_school_city, high_school_state,
       graduation_year, intended_major, intended_major_alt, gpa_scale,
       counselor_name, counselor_email,
       app_round, target_school_count, preferred_location, preferred_size, financial_aid_needed,
       email_reminders, deadline_alerts, weekly_summary, share_data_analytics, allow_counselor_access,
       updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,CURRENT_TIMESTAMP
     )
     ON CONFLICT (user_id) DO UPDATE SET
       phone                  = EXCLUDED.phone,
       parent_email           = EXCLUDED.parent_email,
       bio                    = EXCLUDED.bio,
       high_school_name       = EXCLUDED.high_school_name,
       high_school_city       = EXCLUDED.high_school_city,
       high_school_state      = EXCLUDED.high_school_state,
       graduation_year        = EXCLUDED.graduation_year,
       intended_major         = EXCLUDED.intended_major,
       intended_major_alt     = EXCLUDED.intended_major_alt,
       gpa_scale              = EXCLUDED.gpa_scale,
       counselor_name         = EXCLUDED.counselor_name,
       counselor_email        = EXCLUDED.counselor_email,
       app_round              = EXCLUDED.app_round,
       target_school_count    = EXCLUDED.target_school_count,
       preferred_location     = EXCLUDED.preferred_location,
       preferred_size         = EXCLUDED.preferred_size,
       financial_aid_needed   = EXCLUDED.financial_aid_needed,
       email_reminders        = EXCLUDED.email_reminders,
       deadline_alerts        = EXCLUDED.deadline_alerts,
       weekly_summary         = EXCLUDED.weekly_summary,
       share_data_analytics   = EXCLUDED.share_data_analytics,
       allow_counselor_access = EXCLUDED.allow_counselor_access,
       updated_at             = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      userId,
      data.phone ?? '', data.parent_email ?? '', data.bio ?? '',
      data.high_school_name ?? '', data.high_school_city ?? '', data.high_school_state ?? '',
      gradYear, data.intended_major ?? '', data.intended_major_alt ?? '',
      data.gpa_scale ?? '4.0', data.counselor_name ?? '', data.counselor_email ?? '',
      data.app_round ?? 'Regular Decision', targetCount,
      data.preferred_location ?? '', data.preferred_size ?? '',
      toBool(data.financial_aid_needed),
      toBool(data.email_reminders ?? true), toBool(data.deadline_alerts ?? true),
      toBool(data.weekly_summary), toBool(data.share_data_analytics ?? true),
      toBool(data.allow_counselor_access ?? true),
    ]
  );
  return res.rows[0];
}
