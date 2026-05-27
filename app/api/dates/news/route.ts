import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Auth guard — prevent unauthenticated LLM token burn
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Today is ${today}. You are an expert college admissions counselor. Generate 4 current, realistic, and informative news items about the college admissions landscape for high school students. Focus on: SAT/ACT policy changes, test-optional trends, application strategy, FAFSA updates, financial aid shifts, or notable admissions news from top universities.

Return ONLY a valid JSON array (no markdown, no preamble) with exactly 4 items:
[
  {
    "headline": "Short punchy headline under 12 words",
    "summary": "2-3 sentence informative summary a student would find useful",
    "tag": "One of: SAT/ACT, Test-Optional, Financial Aid, Strategy, Deadlines, Trends"
  }
]`
        }],
      }),
    });

    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const text = data.content?.[0]?.text ?? '[]';
    const clean = text.replace(/```json|```/g, '').trim();
    const news = JSON.parse(clean);
    return NextResponse.json(news);
  } catch (error) {
    console.error('[News API] error:', error);
    return NextResponse.json({ error: 'Failed to generate news' }, { status: 500 });
  }
}
