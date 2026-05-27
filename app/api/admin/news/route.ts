import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { isAdmin } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

// GET — list all news items (admin sees all, public sees visible only)
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const pool = getPool();
  const { searchParams } = new URL(request.url);
  const adminView = searchParams.get('admin') === '1';

  if (adminView) {
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const result = await pool.query('SELECT * FROM admissions_news ORDER BY is_custom DESC NULLS LAST, created_at DESC');
    return NextResponse.json(result.rows);
  }

  // Public: only visible items, latest 6
  const result = await pool.query('SELECT * FROM admissions_news WHERE is_visible = true ORDER BY is_custom DESC NULLS LAST, created_at DESC LIMIT 6');
  return NextResponse.json(result.rows);
}

// POST — add custom article OR generate AI news
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = getPool();

  // ── Custom article: { custom: true, headline, summary, tag, source_url } ──
  let body: any = {};
  try { body = await request.json(); } catch { body = {}; }

  if (body.custom === true) {
    try {
      await pool.query(
        'INSERT INTO admissions_news (headline, summary, tag, source_url, is_custom) VALUES ($1, $2, $3, $4, true)',
        [body.headline, body.summary, body.tag || 'Trends', body.source_url || null]
      );
      const result = await pool.query('SELECT * FROM admissions_news ORDER BY is_custom DESC NULLS LAST, created_at DESC');
      return NextResponse.json(result.rows);
    } catch (err) {
      console.error('[Admin News Custom]', err);
      return NextResponse.json({ error: 'Failed to save custom article' }, { status: 500 });
    }
  }

  // ── AI-generated news ──
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey || openaiKey === 'sk-your-openai-api-key-here') {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 503 });
    }

    // ── Step 1: Fetch real news via Google News RSS feeds ──
    // We search multiple queries to cover different admissions topics
    const searchQueries = [
      'college admissions policy change 2026',
      'SAT ACT test optional university 2026',
      'FAFSA financial aid college update',
      'top university admissions statistics',
      'college application deadline change',
    ];

    const allArticles: { title: string; snippet: string; link: string; source: string }[] = [];

    for (const query of searchQueries) {
      try {
        // Use Google News RSS which is publicly accessible
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
        const rssRes = await fetch(rssUrl, { signal: AbortSignal.timeout(5000) });
        if (rssRes.ok) {
          const rssText = await rssRes.text();
          // Simple XML parsing for RSS items
          const items = rssText.match(/<item>[\s\S]*?<\/item>/g) || [];
          for (const item of items.slice(0, 4)) {
            const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
            const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
            const source = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
            if (title && link) {
              allArticles.push({ title, snippet: '', link, source });
            }
          }
        }
      } catch {}
    }

    // Deduplicate by title similarity and limit
    const seen = new Set<string>();
    const uniqueArticles = allArticles.filter(a => {
      const key = a.title.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);

    // ── Step 2: Feed to GPT-4o for summarization + formatting ──
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: openaiKey });

    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const articleList = uniqueArticles.length > 0
      ? uniqueArticles.map((a, i) => `${i + 1}. "${a.title}" (${a.source || 'News'}) — ${a.link}`).join('\n')
      : 'No articles found from web search.';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      temperature: 0.8,
      messages: [{
        role: 'user',
        content: `Today is ${today}. You are a college admissions news editor.

${uniqueArticles.length > 0 ? `Here are real news articles from Google News:\n\n${articleList}\n\nUsing ONLY these real articles as sources, create 10 news items for high school students. Each item must be based on a real article above. Include the source URL.` : `Generate exactly 10 current, realistic, and informative news items about college admissions. Each MUST name a specific top-100 US college (MIT, Stanford, Harvard, Yale, Princeton, Columbia, UPenn, Duke, Northwestern, Caltech, Georgia Tech, UCLA, UC Berkeley, UMich, UVA, Carnegie Mellon, Johns Hopkins, Brown, Dartmouth, Rice). Use different schools for each item. Focus on: SAT/ACT policy changes, test-optional decisions, financial aid updates, FAFSA changes, application deadline shifts, new program launches, acceptance rate changes, campus expansions. Make each item specific and factual-sounding with real details.`}

CRITICAL: You MUST return EXACTLY 10 items. Return ONLY a valid JSON array (no markdown, no backticks, no explanation):
[
  {
    "headline": "Short punchy headline under 12 words mentioning a school name",
    "summary": "2-3 sentence informative summary with specific details a student would find useful",
    "tag": "One of: SAT/ACT, Test-Optional, Financial Aid, Strategy, Deadlines, Trends, Rankings, New Programs",
    "source_url": "${uniqueArticles.length > 0 ? 'URL from the article list, or empty string' : ''}"
  }
]`
      }],
    });

    const text = completion.choices[0]?.message?.content ?? '[]';
    const clean = text.replace(/```json|```/g, '').trim();
    const news = JSON.parse(clean);

    // ── Step 3: Save to DB ──
    for (const item of news) {
      await pool.query(
        'INSERT INTO admissions_news (headline, summary, tag, source_url) VALUES ($1, $2, $3, $4)',
        [item.headline, item.summary, item.tag, item.source_url || null]
      );
    }

    // Return all news — custom articles first
    const result = await pool.query('SELECT * FROM admissions_news ORDER BY is_custom DESC NULLS LAST, created_at DESC');
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('[Admin News POST]', error);
    return NextResponse.json({ error: 'Failed to generate news' }, { status: 500 });
  }
}

// PATCH — toggle visibility
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, is_visible } = await request.json();
  const pool = getPool();
  await pool.query('UPDATE admissions_news SET is_visible = $1 WHERE id = $2', [is_visible, id]);
  return NextResponse.json({ ok: true });
}

// DELETE — remove a news item
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await request.json();
  const pool = getPool();
  await pool.query('DELETE FROM admissions_news WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
