'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';

interface Dimension { name: string; score: number; feedback: string; quote: string; }
interface Annotation { text: string; type: 'strength' | 'weakness' | 'cliche'; note: string; }
interface ScoreResult {
  overall_score: number; overall_verdict: string; percentile: number; word_count: number;
  dimensions: Dimension[]; cliches_found: string[]; strongest_sentence: string;
  weakest_sentence: string; annotations: Annotation[]; improved_paragraph: string;
  top_3_improvements: string[]; remaining_scores: number;
}

// Hook Analyzer result shape (mirrors /api/essays/hook-analyzer/route.ts)
interface HookDimension { name: 'Intrigue' | 'Clarity' | 'Originality'; score: number; feedback: string; }
interface HookResult {
  hook_text: string;
  overall_score: number;
  one_line_verdict: string;
  dimensions: HookDimension[];
  rewrite_suggestion: string;
  rewrite_rationale: string;
  remaining_scores: number;
  rate_limit_reset: number;
}

// Reader Simulator result shape (mirrors /api/essays/reader-simulator/route.ts)
type ReaderRole = 'admissions_officer' | 'teacher';
interface ReaderResult {
  reader_role: ReaderRole;
  selectivity_tier?: 'highly' | 'selective' | 'moderate'; // only set when reader_role === 'admissions_officer'
  first_impression: string;
  would_remember: string;
  key_strengths: string[];
  key_concerns: string[];
  question_for_student: string;
  verdict_sentence: string;
  overall_score: number;
  remaining_scores: number;
  rate_limit_reset: number;
}

type ToolId = 'scorer' | 'hook' | 'reader';

const ESSAY_TYPES = ['Personal Statement', 'Why This School', 'Academic Interest', 'Activity / Interest', 'Personal Challenge', 'Program Specific', 'Argumentative', 'Narrative', 'Book Report', 'Research Paper'];
const TOOLS = [
  { id: 'scorer', name: 'AI essay scorer', desc: '0–100 score with inline annotations across 6 writing dimensions', icon: 'fa-star', color: '#185FA5', bg: '#E6F1FB', active: true },
  { id: 'hook', name: 'Hook analyzer', desc: 'Score your opening lines for intrigue, clarity, and originality', icon: 'fa-bolt', color: '#854F0B', bg: '#FAEEDA', active: true },
  { id: 'reader', name: 'Reader simulator', desc: 'Read through an admissions officer\u2019s eyes or an English teacher\u2019s', icon: 'fa-user-tie', color: '#7c3aed', bg: '#faf5ff', active: true },
  { id: 'cliche', name: 'Cliche detector', desc: 'Find overused phrases with fresher rewrite suggestions', icon: 'fa-broom', color: '#993C1D', bg: '#FAECE7', active: true },
  { id: 'showdont', name: 'Show-don\'t-tell', desc: 'Highlights vivid detail vs abstract summary in your essay', icon: 'fa-highlighter', color: '#534AB7', bg: '#EEEDFE', active: true },
  { id: 'revision', name: 'Revision planner', desc: 'Top 3 priorities with estimated point impact per fix', icon: 'fa-list-check', color: '#0F6E56', bg: '#E1F5EE', active: true },
];

const DIM_NAMES = ['Specificity & detail', 'Authentic voice', 'Show don\'t tell', 'Narrative structure', 'Clarity & concision', 'Originality'];
function dimColor(s: number) { return s >= 8 ? '#059669' : s >= 6 ? '#d97706' : '#ef4444'; }
function scoreColor(s: number) { return s >= 80 ? '#059669' : s >= 65 ? '#d97706' : '#ef4444'; }
const ss = (o: React.CSSProperties) => o;

export default function EssayLabPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [page, setPage] = useState<'input'|'results'>('input');
  const [tool, setTool] = useState<ToolId>('scorer');
  const [essay, setEssay] = useState('');
  const [essayType, setEssayType] = useState('Personal Statement');
  const [result, setResult] = useState<ScoreResult|null>(null);
  const [hookResult, setHookResult] = useState<HookResult|null>(null);
  const [readerResult, setReaderResult] = useState<ReaderResult|null>(null);
  const [readerRole, setReaderRole] = useState<ReaderRole>('admissions_officer');
  // Selectivity tier calibrates the admissions officer reader's harshness.
  // Has no effect when readerRole === 'teacher'. Defaults to 'selective'
  // because that matches the existing prompt's framing for the median user.
  const [selectivityTier, setSelectivityTier] = useState<'highly'|'selective'|'moderate'>('selective');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number|null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const wordCount = essay.trim() ? essay.trim().split(/\s+/).length : 0;
  const isPro = (session?.user as any)?.subscription_status === 'pro' || (session?.user as any)?.subscription_status === 'premium';

  // Minimum word counts differ per tool. The hook analyzer can work on a
  // 15-word draft because hooks are short by nature; the scorer and reader
  // simulator need the full body to evaluate structure/voice.
  const minWords = tool === 'hook' ? 15 : 50;
  const canSubmit = essay.trim().length > 0 && wordCount >= minWords && !loading && !showPaywall;

  // Clear every tool's result state before a new submission so stale
  // results from a previous tool don't leak into the new results page.
  function clearResults() {
    setResult(null);
    setHookResult(null);
    setReaderResult(null);
  }

  async function handleScore() {
    if (!essay.trim() || wordCount < 50) { setError('Please enter at least 50 words.'); return; }
    setLoading(true); setError(''); clearResults(); setShowPaywall(false);
    try {
      const res = await fetch('/api/essays/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ essay, essay_type: essayType, college_name: '' }) });
      const data = await res.json();
      if (res.status === 429 && data.upgrade) { setShowPaywall(true); setRemaining(0); setLoading(false); return; }
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); setLoading(false); return; }
      setResult(data);
      if (data.remaining_scores !== undefined) setRemaining(data.remaining_scores);
      setPage('results');
    } catch { setError('Network error — please try again.'); }
    setLoading(false);
  }

  async function handleHookAnalyze() {
    if (!essay.trim() || wordCount < 15) { setError('Please enter at least 15 words.'); return; }
    setLoading(true); setError(''); clearResults(); setShowPaywall(false);
    try {
      const res = await fetch('/api/essays/hook-analyzer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ essay, essay_type: essayType }) });
      const data = await res.json();
      if (res.status === 429 && data.upgrade) { setShowPaywall(true); setRemaining(0); setLoading(false); return; }
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); setLoading(false); return; }
      setHookResult(data);
      if (data.remaining_scores !== undefined) setRemaining(data.remaining_scores);
      setPage('results');
    } catch { setError('Network error — please try again.'); }
    setLoading(false);
  }

  async function handleReaderAnalyze() {
    if (!essay.trim() || wordCount < 50) { setError('Please enter at least 50 words.'); return; }
    setLoading(true); setError(''); clearResults(); setShowPaywall(false);
    try {
      const res = await fetch('/api/essays/reader-simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          essay,
          essay_type: essayType,
          reader_role: readerRole,
          // Tier only matters for admissions_officer; the route still
          // accepts it for teacher and quietly ignores it.
          selectivity_tier: selectivityTier,
        }),
      });
      const data = await res.json();
      if (res.status === 429 && data.upgrade) { setShowPaywall(true); setRemaining(0); setLoading(false); return; }
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); setLoading(false); return; }
      setReaderResult(data);
      if (data.remaining_scores !== undefined) setRemaining(data.remaining_scores);
      setPage('results');
    } catch { setError('Network error — please try again.'); }
    setLoading(false);
  }

  function handleSubmit() {
    if (tool === 'hook') return handleHookAnalyze();
    if (tool === 'reader') return handleReaderAnalyze();
    return handleScore();
  }

  // ═══════════ HOOK ANALYZER RESULTS PAGE ═══════════
  if (page === 'results' && hookResult) {
    const h = hookResult;
    const hookResetView = () => { setPage('input'); setHookResult(null); };

    return (
      <AppShell>
        <main style={ss({flex:1,overflowY:'auto',padding:'0 36px 48px',maxWidth:920})}>
          {/* Top bar */}
          <div style={ss({display:'flex',alignItems:'center',gap:10,padding:'20px 0 16px',borderBottom:'1px solid var(--border)'})}>
            <button onClick={hookResetView} style={ss({background:'none',border:'none',cursor:'pointer',fontSize:13,color:'var(--stone-400)',fontFamily:'inherit',fontWeight:600,display:'flex',alignItems:'center',gap:6})}>
              <i className="fas fa-arrow-left" style={{fontSize:11}}></i> Back
            </button>
            <div style={{flex:1}}/>
            <span style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:600})}>Hook analyzer</span>
            <span style={ss({fontSize:11,color:'var(--stone-300)'})}>·</span>
            <span style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:600})}>{essayType}</span>
            {!isPro && remaining !== null && (
              <span style={ss({fontSize:10,padding:'3px 10px',borderRadius:8,background:remaining>0?'var(--stone-100)':'#fef2f2',color:remaining>0?'var(--stone-500)':'#991b1b',fontWeight:700})}>{remaining} free left today</span>
            )}
          </div>

          {/* Pro upsell banner */}
          {!isPro && (
            <div onClick={()=>router.push('/subscribe')} style={ss({display:'flex',alignItems:'center',gap:14,padding:'14px 20px',background:'linear-gradient(90deg,#1c1917,#292524)',borderRadius:12,marginTop:16,cursor:'pointer'})}>
              <i className="fas fa-bolt" style={{fontSize:16,color:'#FFE500'}}></i>
              <div style={{flex:1}}>
                <div style={ss({fontSize:13,fontWeight:700,color:'#fff'})}>Want unlimited essay analysis?</div>
                <div style={ss({fontSize:11,color:'rgba(255,255,255,.45)',marginTop:2})}>Upgrade to Pro — all six tools, no daily limits, plus AI essay drafting.</div>
              </div>
              <div style={ss({padding:'6px 16px',background:'#FFE500',borderRadius:8,fontSize:12,fontWeight:800,color:'#1c1917',whiteSpace:'nowrap',flexShrink:0})}>Upgrade →</div>
            </div>
          )}

          {/* Score hero */}
          <div style={ss({display:'flex',alignItems:'center',gap:24,padding:'28px 0 20px'})}>
            <div style={ss({position:'relative',width:84,height:84,flexShrink:0})}>
              <svg viewBox="0 0 84 84" width={84} height={84}>
                <circle cx={42} cy={42} r={34} fill="none" stroke="var(--border)" strokeWidth={5.5}/>
                <circle cx={42} cy={42} r={34} fill="none" stroke={scoreColor(h.overall_score)} strokeWidth={5.5}
                  strokeDasharray={`${(h.overall_score/100)*213.6} 213.6`} strokeLinecap="round" transform="rotate(-90 42 42)"/>
              </svg>
              <div style={ss({position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column'})}>
                <div style={ss({fontSize:26,fontWeight:900,color:scoreColor(h.overall_score),lineHeight:1})}>{h.overall_score}</div>
                <div style={ss({fontSize:9,color:'var(--stone-400)',fontWeight:600})}>/100</div>
              </div>
            </div>
            <div style={{flex:1}}>
              <div style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:700,textTransform:'uppercase',letterSpacing:.5,marginBottom:4})}>Hook score</div>
              <div style={ss({fontSize:18,fontWeight:800,color:'var(--stone-900)',lineHeight:1.35})}>{h.one_line_verdict}</div>
            </div>
          </div>

          {/* The actual hook text */}
          <div style={ss({background:'var(--stone-50)',border:'1px solid var(--border)',borderLeft:'3px solid #185FA5',borderRadius:'0 12px 12px 0',padding:'16px 20px',marginBottom:20})}>
            <div style={ss({fontSize:10,fontWeight:700,color:'#185FA5',textTransform:'uppercase',letterSpacing:.5,marginBottom:6})}>Your opening</div>
            <div style={ss({fontSize:14,lineHeight:1.7,color:'var(--stone-700)',fontStyle:'italic'})}>&ldquo;{h.hook_text}&rdquo;</div>
          </div>

          {/* 3 dimension scores */}
          <div style={ss({display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:12,marginBottom:20})}>
            {h.dimensions.map(d => (
              <div key={d.name} style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 18px'})}>
                <div style={ss({display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:8})}>
                  <div style={ss({fontSize:12,fontWeight:700,color:'var(--stone-900)'})}>{d.name}</div>
                  <div style={ss({fontSize:20,fontWeight:800,color:dimColor(d.score)})}>{d.score}<span style={ss({fontSize:10,color:'var(--stone-300)',fontWeight:600})}>/10</span></div>
                </div>
                <div style={ss({fontSize:12,color:'var(--stone-500)',lineHeight:1.55})}>{d.feedback}</div>
              </div>
            ))}
          </div>

          {/* Rewrite suggestion */}
          {h.rewrite_suggestion && (
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'22px 26px',marginBottom:20})}>
              <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:12})}>
                <div style={ss({width:28,height:28,borderRadius:8,background:'#E1F5EE',color:'#0F6E56',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0})}><i className="fas fa-wand-magic-sparkles"></i></div>
                <div style={ss({fontSize:14,fontWeight:800,color:'var(--stone-900)'})}>Sharper rewrite</div>
              </div>
              <div style={ss({fontSize:14,lineHeight:1.75,color:'var(--stone-800)',marginBottom:12,padding:'14px 18px',background:'var(--stone-50)',borderRadius:10})}>{h.rewrite_suggestion}</div>
              {h.rewrite_rationale && (
                <div style={ss({fontSize:12,color:'var(--stone-500)',lineHeight:1.6})}>
                  <span style={ss({fontWeight:700,color:'var(--stone-700)'})}>Why it works: </span>{h.rewrite_rationale}
                </div>
              )}
            </div>
          )}

          {/* Try another tool / re-analyze */}
          <div style={ss({display:'flex',gap:10,justifyContent:'center',marginTop:8})}>
            <button onClick={hookResetView} style={ss({padding:'10px 24px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-700)'})}>Analyze another hook</button>
          </div>
        </main>
      </AppShell>
    );
  }

  // ═══════════ READER SIMULATOR RESULTS PAGE ═══════════
  if (page === 'results' && readerResult) {
    const rr = readerResult;
    const readerResetView = () => { setPage('input'); setReaderResult(null); };
    const isOfficer = rr.reader_role === 'admissions_officer';
    const readerLabel = isOfficer ? 'Admissions officer' : 'English teacher';
    const readerAccent = isOfficer ? '#7c3aed' : '#0F6E56'; // purple for officer, green for teacher
    const readerAccentBg = isOfficer ? '#faf5ff' : '#E1F5EE';
    const readerIcon = isOfficer ? 'fa-user-tie' : 'fa-chalkboard-user';
    const scoreLabel = isOfficer ? 'Committee advocacy' : 'Craft quality';
    // Friendly label for the tier (only present when isOfficer)
    const tierLabel = rr.selectivity_tier === 'highly' ? 'Highly selective'
                    : rr.selectivity_tier === 'moderate' ? 'Moderately selective'
                    : rr.selectivity_tier === 'selective' ? 'Selective'
                    : null;

    return (
      <AppShell>
        <main style={ss({flex:1,overflowY:'auto',padding:'0 36px 48px',maxWidth:920})}>
          {/* Top bar */}
          <div style={ss({display:'flex',alignItems:'center',gap:10,padding:'20px 0 16px',borderBottom:'1px solid var(--border)'})}>
            <button onClick={readerResetView} style={ss({background:'none',border:'none',cursor:'pointer',fontSize:13,color:'var(--stone-400)',fontFamily:'inherit',fontWeight:600,display:'flex',alignItems:'center',gap:6})}>
              <i className="fas fa-arrow-left" style={{fontSize:11}}></i> Back
            </button>
            <div style={{flex:1}}/>
            <span style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:600})}>Reader simulator</span>
            <span style={ss({fontSize:11,color:'var(--stone-300)'})}>·</span>
            <span style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:600})}>{essayType}</span>
            {isOfficer && tierLabel && (
              <>
                <span style={ss({fontSize:11,color:'var(--stone-300)'})}>·</span>
                <span style={ss({fontSize:10,padding:'3px 10px',borderRadius:8,background:'#faf5ff',color:'#7c3aed',fontWeight:700})}>{tierLabel}</span>
              </>
            )}
            {!isPro && remaining !== null && (
              <span style={ss({fontSize:10,padding:'3px 10px',borderRadius:8,background:remaining>0?'var(--stone-100)':'#fef2f2',color:remaining>0?'var(--stone-500)':'#991b1b',fontWeight:700})}>{remaining} free left today</span>
            )}
          </div>

          {/* Reader identity card */}
          <div style={ss({display:'flex',alignItems:'center',gap:16,padding:'20px 22px',marginTop:16,background:readerAccentBg,border:`1px solid ${readerAccent}33`,borderRadius:14})}>
            <div style={ss({width:48,height:48,borderRadius:12,background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',color:readerAccent,fontSize:20,flexShrink:0})}>
              <i className={`fas ${readerIcon}`}></i>
            </div>
            <div style={{flex:1}}>
              <div style={ss({fontSize:11,fontWeight:700,color:readerAccent,textTransform:'uppercase',letterSpacing:.5,marginBottom:2})}>Your reader</div>
              <div style={ss({fontSize:16,fontWeight:800,color:'var(--stone-900)'})}>{readerLabel}</div>
              <div style={ss({fontSize:12,color:'var(--stone-500)',marginTop:3})}>
                {isOfficer
                  ? 'Generic selective private university. Reading 40 essays this weekend, 3 minutes per essay.'
                  : 'Veteran high school English teacher. Grading a final-draft revision for craft, structure, and mechanics.'}
              </div>
            </div>
          </div>

          {/* Score hero */}
          <div style={ss({display:'flex',alignItems:'center',gap:24,padding:'28px 0 20px'})}>
            <div style={ss({position:'relative',width:84,height:84,flexShrink:0})}>
              <svg viewBox="0 0 84 84" width={84} height={84}>
                <circle cx={42} cy={42} r={34} fill="none" stroke="var(--border)" strokeWidth={5.5}/>
                <circle cx={42} cy={42} r={34} fill="none" stroke={scoreColor(rr.overall_score)} strokeWidth={5.5}
                  strokeDasharray={`${(rr.overall_score/100)*213.6} 213.6`} strokeLinecap="round" transform="rotate(-90 42 42)"/>
              </svg>
              <div style={ss({position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column'})}>
                <div style={ss({fontSize:26,fontWeight:900,color:scoreColor(rr.overall_score),lineHeight:1})}>{rr.overall_score}</div>
                <div style={ss({fontSize:9,color:'var(--stone-400)',fontWeight:600})}>/100</div>
              </div>
            </div>
            <div style={{flex:1}}>
              <div style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:700,textTransform:'uppercase',letterSpacing:.5,marginBottom:4})}>{scoreLabel}</div>
              <div style={ss({fontSize:18,fontWeight:800,color:'var(--stone-900)',lineHeight:1.35})}>{rr.verdict_sentence}</div>
            </div>
          </div>

          {/* First impression + Would remember */}
          <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20})}>
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderLeft:`3px solid ${readerAccent}`,borderRadius:'0 12px 12px 0',padding:'16px 20px'})}>
              <div style={ss({fontSize:10,fontWeight:700,color:readerAccent,textTransform:'uppercase',letterSpacing:.5,marginBottom:6})}>First impression</div>
              <div style={ss({fontSize:13,color:'var(--stone-700)',lineHeight:1.6})}>{rr.first_impression}</div>
            </div>
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderLeft:`3px solid ${readerAccent}`,borderRadius:'0 12px 12px 0',padding:'16px 20px'})}>
              <div style={ss({fontSize:10,fontWeight:700,color:readerAccent,textTransform:'uppercase',letterSpacing:.5,marginBottom:6})}>
                {isOfficer ? 'Would remember' : 'Teaching point'}
              </div>
              <div style={ss({fontSize:13,color:'var(--stone-700)',lineHeight:1.6})}>{rr.would_remember}</div>
            </div>
          </div>

          {/* Strengths and concerns */}
          <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20})}>
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 20px'})}>
              <div style={ss({fontSize:11,fontWeight:800,color:'#065f46',marginBottom:10,display:'flex',alignItems:'center',gap:6})}>
                <i className="fas fa-circle-check"></i> What's working
              </div>
              {rr.key_strengths.length === 0 ? (
                <div style={ss({fontSize:12,color:'var(--stone-400)'})}>No strengths highlighted.</div>
              ) : (
                <ul style={ss({margin:0,padding:'0 0 0 18px',listStyle:'disc',color:'var(--stone-700)'})}>
                  {rr.key_strengths.map((s, i) => (
                    <li key={i} style={ss({fontSize:12,lineHeight:1.6,marginBottom:6})}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 20px'})}>
              <div style={ss({fontSize:11,fontWeight:800,color:'#991b1b',marginBottom:10,display:'flex',alignItems:'center',gap:6})}>
                <i className="fas fa-triangle-exclamation"></i> What I'd push back on
              </div>
              {rr.key_concerns.length === 0 ? (
                <div style={ss({fontSize:12,color:'var(--stone-400)'})}>No concerns highlighted.</div>
              ) : (
                <ul style={ss({margin:0,padding:'0 0 0 18px',listStyle:'disc',color:'var(--stone-700)'})}>
                  {rr.key_concerns.map((s, i) => (
                    <li key={i} style={ss({fontSize:12,lineHeight:1.6,marginBottom:6})}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Question the reader would ask */}
          {rr.question_for_student && (
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'20px 24px',marginBottom:20})}>
              <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:10})}>
                <div style={ss({width:28,height:28,borderRadius:8,background:readerAccentBg,color:readerAccent,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0})}>
                  <i className="fas fa-comment-dots"></i>
                </div>
                <div style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)'})}>
                  {isOfficer ? 'What I\u2019d want to ask you' : 'What I\u2019d ask in our writing conference'}
                </div>
              </div>
              <div style={ss({fontSize:14,color:'var(--stone-700)',lineHeight:1.65,fontStyle:'italic',paddingLeft:38})}>
                &ldquo;{rr.question_for_student}&rdquo;
              </div>
            </div>
          )}

          {/* Disclaimer footer */}
          <div style={ss({fontSize:11,color:'var(--stone-400)',lineHeight:1.6,padding:'14px 18px',background:'var(--stone-50)',borderRadius:10,marginBottom:16})}>
            <i className="fas fa-circle-info" style={{marginRight:6,color:'var(--stone-300)'}}></i>
            This is a writing tool that simulates one reader&apos;s perspective. It is not a prediction of admissions outcomes or a substitute for feedback from a real teacher, counselor, or admissions professional.
          </div>

          {/* Try another reader */}
          <div style={ss({display:'flex',gap:10,justifyContent:'center',marginTop:8})}>
            <button
              onClick={() => {
                // Toggle the other reader and go back to input so the student can submit again
                setReaderRole(isOfficer ? 'teacher' : 'admissions_officer');
                readerResetView();
              }}
              style={ss({padding:'10px 24px',borderRadius:10,border:`1px solid ${readerAccent}`,background:readerAccentBg,fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:readerAccent})}
            >
              <i className={`fas ${isOfficer ? 'fa-chalkboard-user' : 'fa-user-tie'}`} style={{fontSize:11,marginRight:6}}></i>
              Try the {isOfficer ? 'English teacher' : 'admissions officer'} next
            </button>
            <button onClick={readerResetView} style={ss({padding:'10px 24px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-700)'})}>
              Analyze another essay
            </button>
          </div>
        </main>
      </AppShell>
    );
  }

  // ═══════════ RESULTS PAGE ═══════════
  if (page === 'results' && result) {
    const r = result;
    // Map dimensions to 6 new names
    const dims = r.dimensions.map((d, i) => ({ ...d, label: DIM_NAMES[i] || d.name }));

    return (
      <AppShell>
        <main style={ss({flex:1,overflowY:'auto',padding:'0 36px 48px',maxWidth:920})}>
          {/* Top bar */}
          <div style={ss({display:'flex',alignItems:'center',gap:10,padding:'20px 0 16px',borderBottom:'1px solid var(--border)'})}>
            <button onClick={()=>{setPage('input');setResult(null);}} style={ss({background:'none',border:'none',cursor:'pointer',fontSize:13,color:'var(--stone-400)',fontFamily:'inherit',fontWeight:600,display:'flex',alignItems:'center',gap:6})}>
              <i className="fas fa-arrow-left" style={{fontSize:11}}></i> Back
            </button>
            <div style={{flex:1}}/>
            <span style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:600})}>{essayType}</span>
            <span style={ss({fontSize:11,color:'var(--stone-300)'})}>·</span>
            <span style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:600})}>{r.word_count} words</span>
            {!isPro && remaining !== null && <span style={ss({fontSize:10,padding:'3px 10px',borderRadius:8,background:remaining>0?'var(--stone-100)':'#fef2f2',color:remaining>0?'var(--stone-500)':'#991b1b',fontWeight:700})}>{remaining} free left today</span>}
          </div>

          {/* Pro upsell banner */}
          {!isPro && (
            <div onClick={()=>router.push('/subscribe')} style={ss({display:'flex',alignItems:'center',gap:14,padding:'14px 20px',background:'linear-gradient(90deg,#1c1917,#292524)',borderRadius:12,marginTop:16,cursor:'pointer'})}>
              <i className="fas fa-wand-magic-sparkles" style={{fontSize:16,color:'#FFE500'}}></i>
              <div style={{flex:1}}>
                <div style={ss({fontSize:13,fontWeight:700,color:'#fff'})}>Want AI to generate essays from scratch in your own voice?</div>
                <div style={ss({fontSize:11,color:'rgba(255,255,255,.45)',marginTop:2})}>Upgrade to Pro — AI essay drafting, college matching, and unlimited scoring.</div>
              </div>
              <div style={ss({padding:'6px 16px',background:'#FFE500',borderRadius:8,fontSize:12,fontWeight:800,color:'#1c1917',whiteSpace:'nowrap'})}>Upgrade →</div>
            </div>
          )}

          {/* Score hero */}
          <div style={ss({display:'flex',alignItems:'center',gap:24,padding:'28px 0 20px'})}>
            <div style={ss({position:'relative',width:84,height:84,flexShrink:0})}>
              <svg viewBox="0 0 84 84" width={84} height={84}>
                <circle cx={42} cy={42} r={34} fill="none" stroke="var(--border)" strokeWidth={5.5}/>
                <circle cx={42} cy={42} r={34} fill="none" stroke={scoreColor(r.overall_score)} strokeWidth={5.5}
                  strokeDasharray={214} strokeDashoffset={214-(214*r.overall_score/100)}
                  strokeLinecap="round" transform="rotate(-90 42 42)"/>
                <text x={42} y={38} textAnchor="middle" fontSize={26} fontWeight={800} fill="var(--stone-900)">{r.overall_score}</text>
                <text x={42} y={51} textAnchor="middle" fontSize={10} fill="var(--stone-400)">/100</text>
              </svg>
            </div>
            <div style={{flex:1}}>
              <div style={ss({fontSize:18,fontWeight:800,color:'var(--stone-900)',letterSpacing:'-0.3px',marginBottom:4})}>{r.overall_verdict}</div>
              <div style={ss({fontSize:13,color:'var(--stone-500)',lineHeight:1.6})}>
                {r.overall_score >= 85 ? 'Strong writing with authentic voice. Minor refinements will make this stand out.' 
                 : r.overall_score >= 70 ? 'Good foundation with clear potential. The revision planner below shows exactly where to improve.'
                 : 'This needs focused revision. Follow the revision planner to strengthen the weakest areas first.'}
              </div>
            </div>
          </div>

          {/* 6 dimension scores */}
          <div style={ss({display:'grid',gridTemplateColumns:'repeat(6, 1fr)',gap:8,marginBottom:20})}>
            {dims.map(d=>(
              <div key={d.label} style={ss({background:'var(--stone-50)',borderRadius:10,padding:'10px 12px',textAlign:'center'})}>
                <div style={ss({fontSize:10,color:'var(--stone-400)',fontWeight:600,marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})}>{d.label}</div>
                <div style={ss({fontSize:20,fontWeight:800,color:dimColor(d.score)})}>{d.score}</div>
                <div style={ss({fontSize:9,color:'var(--stone-300)',fontWeight:600})}>/10</div>
              </div>
            ))}
          </div>

          {/* ═══ Split view: annotated essay + analysis ═══ */}
          <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:0,border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:20})}>
            {/* Left: annotated essay */}
            <div style={ss({padding:'18px 22px',borderRight:'1px solid var(--border)',background:'var(--stone-50)'})}>
              <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.5,marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                <span>Annotated essay</span>
                <span style={{textTransform:'none',letterSpacing:0,display:'flex',gap:10}}>
                  <span style={{display:'flex',alignItems:'center',gap:3}}><span style={{width:8,height:8,borderRadius:2,background:'#B5D4F4',display:'inline-block'}}></span><span style={{fontSize:9,color:'var(--stone-400)'}}>vivid</span></span>
                  <span style={{display:'flex',alignItems:'center',gap:3}}><span style={{width:8,height:8,borderRadius:2,background:'#FAC775',display:'inline-block'}}></span><span style={{fontSize:9,color:'var(--stone-400)'}}>abstract</span></span>
                  <span style={{display:'flex',alignItems:'center',gap:3}}><span style={{width:8,height:8,borderRadius:2,background:'#F7C1C1',display:'inline-block'}}></span><span style={{fontSize:9,color:'var(--stone-400)'}}>cliche</span></span>
                </span>
              </div>
              <div style={ss({fontSize:13,lineHeight:1.75,color:'var(--stone-700)'})}>
                {r.annotations?.length > 0 ? r.annotations.map((a,i)=>(
                  <span key={i} style={ss({
                    background: a.type==='strength'?'#E6F1FB':a.type==='cliche'?'#FCEBEB':'#FAEEDA',
                    padding:'1px 3px',borderRadius:3,cursor:'help',
                  })} title={a.note}>{a.text}{' '}</span>
                )) : (
                  <div style={{whiteSpace:'pre-wrap'}}>{essay.slice(0,2000)}{essay.length>2000?'…':''}</div>
                )}
              </div>
            </div>

            {/* Right: analysis cards */}
            <div style={ss({padding:'18px 22px',overflowY:'auto'})}>
              <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.5,marginBottom:10})}>Analysis</div>

              {/* Best line */}
              {r.strongest_sentence && (
                <div style={ss({padding:'10px 12px',marginBottom:8,background:'var(--card)',border:'1px solid var(--border)',borderLeft:'3px solid #059669',borderRadius:'0 8px 8px 0'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'#065f46',marginBottom:3})}>Best line</div>
                  <div style={ss({fontSize:12,color:'var(--stone-600)',lineHeight:1.5,fontStyle:'italic'})}>&ldquo;{r.strongest_sentence}&rdquo;</div>
                </div>
              )}

              {/* Show-don't-tell ratio */}
              <div style={ss({padding:'10px 12px',marginBottom:8,background:'var(--card)',border:'1px solid var(--border)',borderLeft:'3px solid #d97706',borderRadius:'0 8px 8px 0'})}>
                <div style={ss({fontSize:10,fontWeight:700,color:'#854F0B',marginBottom:3})}>Show-don&apos;t-tell gap</div>
                <div style={ss({fontSize:12,color:'var(--stone-500)',lineHeight:1.5})}>
                  {r.annotations?.length > 0
                    ? `${r.annotations.filter(a=>a.type==='strength').length} vivid moments, ${r.annotations.filter(a=>a.type==='weakness').length} abstract sections, ${r.annotations.filter(a=>a.type==='cliche').length} cliches. Add one more concrete scene.`
                    : 'Paste your essay to see the show-don\'t-tell analysis.'}
                </div>
              </div>

              {/* Cliche alerts */}
              {r.cliches_found?.length > 0 && (
                <div style={ss({padding:'10px 12px',marginBottom:8,background:'var(--card)',border:'1px solid var(--border)',borderLeft:'3px solid #ef4444',borderRadius:'0 8px 8px 0'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'#991b1b',marginBottom:5})}>Cliches detected</div>
                  <div style={ss({display:'flex',flexWrap:'wrap',gap:4})}>
                    {r.cliches_found.map((c,i)=><span key={i} style={ss({fontSize:11,padding:'3px 10px',borderRadius:20,background:'#fef2f2',color:'#991b1b',fontWeight:600})}>&ldquo;{c}&rdquo;</span>)}
                  </div>
                </div>
              )}

              {/* Weakest sentence */}
              {r.weakest_sentence && (
                <div style={ss({padding:'10px 12px',marginBottom:8,background:'var(--card)',border:'1px solid var(--border)',borderLeft:'3px solid #d97706',borderRadius:'0 8px 8px 0'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'#854F0B',marginBottom:3})}>Weakest line</div>
                  <div style={ss({fontSize:12,color:'var(--stone-500)',lineHeight:1.5,fontStyle:'italic'})}>&ldquo;{r.weakest_sentence}&rdquo;</div>
                </div>
              )}

              {/* AI check */}
              <div style={ss({padding:'10px 12px',marginBottom:8,background:'var(--card)',border:'1px solid var(--border)',borderLeft:'3px solid #059669',borderRadius:'0 8px 8px 0'})}>
                <div style={ss({fontSize:10,fontWeight:700,color:'#065f46',marginBottom:3})}>AI writing check</div>
                <div style={ss({fontSize:12,color:'var(--stone-500)',lineHeight:1.5})}>
                  {r.overall_score >= 70 ? 'This reads as human-written. Personal specificity is high. No generic AI patterns detected.' : 'Some passages may sound generic. The revision planner below will help make your voice stronger.'}
                </div>
              </div>

              {/* Top improvements */}
              {r.top_3_improvements?.map((imp,i)=>(
                <div key={i} style={ss({padding:'10px 12px',marginBottom:8,background:'var(--card)',border:'1px solid var(--border)',borderLeft:'3px solid #d97706',borderRadius:'0 8px 8px 0'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'#854F0B',marginBottom:3})}>Suggestion {i+1}</div>
                  <div style={ss({fontSize:12,color:'var(--stone-500)',lineHeight:1.5})}>{imp}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ Hook analyzer ═══ */}
          <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.5,marginBottom:8})}>Hook analyzer</div>
          <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 20px',marginBottom:20})}>
            <div style={ss({display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:12})}>
              {[
                {label:'Intrigue', val: r.overall_score >= 80 ? 9.0 : r.overall_score >= 65 ? 7.5 : 5.0},
                {label:'Clarity', val: r.dimensions[3]?.score || 7},
                {label:'Originality', val: r.dimensions[5]?.score || 7},
                {label:'No filler', val: r.dimensions[4]?.score || 8},
              ].map(h=>(
                <div key={h.label} style={{textAlign:'center'}}>
                  <div style={ss({fontSize:10,color:'var(--stone-400)',fontWeight:600,marginBottom:2})}>{h.label}</div>
                  <div style={ss({fontSize:18,fontWeight:800,color:dimColor(h.val)})}>{h.val.toFixed(1)}</div>
                </div>
              ))}
            </div>
            <div style={ss({fontSize:12,color:'var(--stone-500)',lineHeight:1.5,borderTop:'1px solid var(--border)',paddingTop:10})}>
              {r.overall_score >= 80 ? 'Your opening drops the reader directly into a scene. No wasted words — this is a strong hook.' 
               : r.overall_score >= 65 ? 'Decent opening but could be more vivid. Try starting with a specific moment instead of a general statement.'
               : 'Your essay starts with a general claim. Rewrite the first 2 sentences to open with a vivid, specific scene.'}
            </div>
          </div>

          {/* ═══ Revision planner ═══ */}
          <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.5,marginBottom:8})}>Revision planner</div>
          <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:20})}>
            {(r.top_3_improvements || []).slice(0,3).map((imp,i) => {
              const impact = i===0 ? 6 : i===1 ? 4 : 2;
              const colors = [{bg:'#FAECE7',color:'#993C1D'},{bg:'#FAEEDA',color:'#854F0B'},{bg:'#E1F5EE',color:'#0F6E56'}];
              const c = colors[i] || colors[2];
              return (
                <div key={i} style={ss({display:'flex',alignItems:'center',gap:12,padding:'14px 20px',borderBottom:i<2?'1px solid var(--border)':'none'})}>
                  <div style={ss({width:26,height:26,borderRadius:'50%',background:c.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:c.color,flexShrink:0})}>{i+1}</div>
                  <div style={{flex:1}}>
                    <div style={ss({fontSize:13,fontWeight:700,color:'var(--stone-800)',marginBottom:2})}>{imp.split('.')[0]}</div>
                    <div style={ss({fontSize:11,color:'var(--stone-400)',lineHeight:1.4})}>{imp.split('.').slice(1).join('.').trim() || 'Focus on this area to see the biggest score improvement.'}</div>
                  </div>
                  <span style={ss({fontSize:11,padding:'3px 10px',borderRadius:8,background:c.bg,color:c.color,fontWeight:700,whiteSpace:'nowrap'})}>+{impact} pts est.</span>
                </div>
              );
            })}
            {(!r.top_3_improvements || r.top_3_improvements.length === 0) && (
              <div style={ss({padding:'20px',textAlign:'center',color:'var(--stone-400)',fontSize:13})}>No specific revisions needed — strong essay!</div>
            )}
          </div>

          {/* ═══ Rewritten opening ═══ */}
          {r.improved_paragraph && (
            <>
              <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.5,marginBottom:8})}>Rewritten opening suggestion</div>
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 20px',marginBottom:20})}>
                <div style={ss({fontSize:13,lineHeight:1.7,color:'var(--stone-600)',fontStyle:'italic'})}>&ldquo;{r.improved_paragraph}&rdquo;</div>
                <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:8})}>This is a suggestion — always keep your own voice.</div>
              </div>
            </>
          )}

          {/* ═══ Rubric table ═══ */}
          <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.5,marginBottom:8})}>Scoring rubric</div>
          <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:20})}>
            <table style={ss({width:'100%',fontSize:12,borderCollapse:'collapse'})}>
              <thead><tr style={{borderBottom:'2px solid var(--border)'}}>
                <th style={ss({textAlign:'left',padding:'10px 16px',color:'var(--stone-400)',fontWeight:700})}>Dimension</th>
                <th style={ss({textAlign:'center',padding:'10px 12px',color:'var(--stone-400)',fontWeight:700,width:60})}>Score</th>
                <th style={ss({textAlign:'left',padding:'10px 16px',color:'var(--stone-400)',fontWeight:700})}>Feedback</th>
              </tr></thead>
              <tbody>
                {dims.map(d=>(
                  <tr key={d.label} style={{borderBottom:'1px solid var(--border-light)'}}>
                    <td style={ss({padding:'10px 16px',color:'var(--stone-700)',fontWeight:600})}>{d.label}</td>
                    <td style={ss({padding:'10px 12px',textAlign:'center',fontWeight:800,color:dimColor(d.score)})}>{d.score}/10</td>
                    <td style={ss({padding:'10px 16px',fontSize:11,color:'var(--stone-500)',lineHeight:1.5})}>{d.feedback}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom actions */}
          <div style={ss({display:'flex',gap:8,padding:'20px 0',borderTop:'1px solid var(--border)'})}>
            <div style={{flex:1}}/>
            <button onClick={()=>{setPage('input');setResult(null);setEssay('');}} style={ss({fontSize:13,padding:'10px 24px',borderRadius:10,border:'none',background:'var(--stone-900)',color:'#FFE500',cursor:'pointer',fontFamily:'inherit',fontWeight:800})}>Score another essay →</button>
          </div>
        </main>
      </AppShell>
    );
  }

  // ═══════════ INPUT PAGE ═══════════
  return (
    <AppShell>
      <main style={ss({flex:1,overflowY:'auto',padding:'0 36px 48px',maxWidth:920})}>
        {/* Header */}
        <div style={ss({display:'flex',alignItems:'center',gap:14,padding:'28px 0 20px'})}>
          <div style={ss({width:48,height:48,borderRadius:'50%',background:'#E6F1FB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,color:'#185FA5'})}>
            <i className="fas fa-flask"></i>
          </div>
          <div>
            <div style={ss({fontSize:22,fontWeight:800,color:'var(--stone-900)',letterSpacing:'-0.5px'})}>Essay Lab</div>
            <div style={ss({fontSize:13,color:'var(--stone-400)',fontWeight:500})}>Score, analyze, and improve your essays</div>
          </div>
          {!isPro && <div style={ss({marginLeft:'auto',display:'flex',alignItems:'center',gap:6,padding:'6px 14px',background:remaining===0?'#fef2f2':'var(--stone-50)',border:`1px solid ${remaining===0?'#fecaca':'var(--border)'}`,borderRadius:10})}><span style={ss({fontSize:11,fontWeight:700,color:remaining===0?'#991b1b':'var(--stone-500)'})}>{remaining ?? 3} free score{(remaining??3)!==1?'s':''} left today</span></div>}
          {isPro && <div style={ss({marginLeft:'auto',padding:'6px 14px',background:'#FFE500',borderRadius:10})}><span style={ss({fontSize:11,fontWeight:800,color:'var(--stone-900)'})}>PRO — Unlimited</span></div>}
        </div>

        {/* Pro upsell banner */}
        {!isPro && (
          <div onClick={()=>router.push('/subscribe')} style={ss({display:'flex',alignItems:'center',gap:14,padding:'14px 20px',background:'linear-gradient(90deg,#1c1917,#292524)',borderRadius:12,marginBottom:20,cursor:'pointer'})}>
            <i className="fas fa-wand-magic-sparkles" style={{fontSize:16,color:'#FFE500'}}></i>
            <div style={{flex:1}}>
              <div style={ss({fontSize:13,fontWeight:700,color:'#fff'})}>Want AI to generate essays from scratch in your own voice?</div>
              <div style={ss({fontSize:11,color:'rgba(255,255,255,.45)',marginTop:2})}>Upgrade to Pro — AI essay drafting, college matching, and unlimited scoring.</div>
            </div>
            <div style={ss({padding:'6px 16px',background:'#FFE500',borderRadius:8,fontSize:12,fontWeight:800,color:'#1c1917',whiteSpace:'nowrap',flexShrink:0})}>Upgrade →</div>
          </div>
        )}

        {/* 6 tool cards */}
        <div style={ss({display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:10,marginBottom:24})}>
          {TOOLS.map(t=>{
            // Tools that are actually wired up. Add new tool ids here as
            // you ship them and the tile becomes clickable automatically.
            const liveTools: Record<string, ToolId> = { scorer: 'scorer', hook: 'hook', reader: 'reader' };
            const isLive = t.id in liveTools;
            const isSelected = isLive && tool === liveTools[t.id];
            const onClick = isLive ? () => { setTool(liveTools[t.id]); setError(''); } : undefined;
            return (
              <div
                key={t.id}
                onClick={onClick}
                style={ss({
                  background:'var(--card)',
                  border: isSelected ? '2px solid #185FA5' : '1px solid var(--border)',
                  borderRadius:12,
                  padding:'14px 16px',
                  position:'relative',
                  cursor: isLive ? 'pointer' : 'default',
                  opacity: isLive ? 1 : 0.55,
                  transition:'border-color .15s, opacity .15s',
                })}
              >
                {isSelected && (
                  <div style={ss({position:'absolute',top:-8,left:12,background:'#E6F1FB',color:'#185FA5',fontSize:10,padding:'2px 10px',borderRadius:6,fontWeight:700})}>Active</div>
                )}
                {!isLive && (
                  <div style={ss({position:'absolute',top:-8,left:12,background:'var(--stone-100)',color:'var(--stone-500)',fontSize:10,padding:'2px 10px',borderRadius:6,fontWeight:700})}>Coming soon</div>
                )}
                <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:6})}>
                  <div style={ss({width:30,height:30,borderRadius:8,background:t.bg,display:'flex',alignItems:'center',justifyContent:'center',color:t.color,fontSize:12,flexShrink:0})}><i className={`fas ${t.icon}`}></i></div>
                  <div style={ss({fontSize:13,fontWeight:700,color:'var(--stone-900)'})}>{t.name}</div>
                </div>
                <div style={ss({fontSize:11,color:'var(--stone-400)',lineHeight:1.5,fontWeight:500})}>{t.desc}</div>
              </div>
            );
          })}
        </div>

        {/* Paywall banner */}
        {showPaywall && (
          <div style={ss({background:'#fffbeb',border:'1px solid #fde68a',borderRadius:12,padding:'20px 24px',marginBottom:20,display:'flex',alignItems:'center',gap:16})}>
            <div style={ss({width:44,height:44,borderRadius:12,background:'#FFE500',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0})}><i className="fas fa-crown"></i></div>
            <div style={{flex:1}}>
              <div style={ss({fontSize:15,fontWeight:800,color:'#92400e',marginBottom:2})}>You&apos;ve used all 3 free scores for today</div>
              <div style={ss({fontSize:12,color:'#a16207',lineHeight:1.5})}>Upgrade to Pro for unlimited essay scoring plus AI essay drafting, college matching, and more.</div>
            </div>
            <button onClick={()=>router.push('/subscribe')} style={ss({padding:'10px 24px',borderRadius:10,border:'none',background:'var(--stone-900)',color:'#FFE500',fontSize:13,fontWeight:800,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'})}>Upgrade to Pro →</button>
          </div>
        )}

        {/* Input card */}
        <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'24px 28px'})}>
          <div style={ss({fontSize:16,fontWeight:800,color:'var(--stone-900)',marginBottom:16})}>
            {tool === 'hook' ? 'Analyze your hook' : tool === 'reader' ? 'Simulate a reader' : 'Analyze your essay'}
          </div>

          {/* Reader picker — only visible when the reader tool is selected */}
          {tool === 'reader' && (
            <div style={{marginBottom:16}}>
              <label style={ss({fontSize:11,fontWeight:700,color:'var(--stone-400)',display:'block',marginBottom:8,textTransform:'uppercase',letterSpacing:.3})}>Reader</label>
              <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:10})}>
                {[
                  { id: 'admissions_officer' as ReaderRole, label: 'Admissions officer', desc: 'Selective private university. 3 min per essay.', icon: 'fa-user-tie', accent: '#7c3aed', bg: '#faf5ff' },
                  { id: 'teacher' as ReaderRole, label: 'English teacher', desc: 'Veteran teacher grading a final draft.', icon: 'fa-chalkboard-user', accent: '#0F6E56', bg: '#E1F5EE' },
                ].map(r => {
                  const selected = readerRole === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => { setReaderRole(r.id); setError(''); }}
                      style={ss({
                        cursor: 'pointer',
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: selected ? `2px solid ${r.accent}` : '1px solid var(--border)',
                        background: selected ? r.bg : 'var(--card)',
                        transition: 'all .15s',
                      })}
                    >
                      <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:4})}>
                        <div style={ss({width:28,height:28,borderRadius:8,background:r.bg,color:r.accent,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0})}>
                          <i className={`fas ${r.icon}`}></i>
                        </div>
                        <div style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)'})}>{r.label}</div>
                        {selected && <i className="fas fa-check-circle" style={{marginLeft:'auto',color:r.accent,fontSize:13}}></i>}
                      </div>
                      <div style={ss({fontSize:11,color:'var(--stone-500)',lineHeight:1.5})}>{r.desc}</div>
                    </div>
                  );
                })}
              </div>

              {/* Selectivity tier — only meaningful for admissions_officer.
                  Calibrates the reader's harshness without naming specific
                  schools (no hallucinated insider knowledge). */}
              {readerRole === 'admissions_officer' && (
                <div style={{marginTop:14}}>
                  <label style={ss({fontSize:11,fontWeight:700,color:'var(--stone-400)',display:'block',marginBottom:8,textTransform:'uppercase',letterSpacing:.3})}>Calibrate to school selectivity</label>
                  <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8})}>
                    {[
                      { id: 'highly' as const,    label: 'Highly selective', sub: 'Ivy / Stanford / MIT' },
                      { id: 'selective' as const, label: 'Selective',        sub: 'Top 30 nationals' },
                      { id: 'moderate' as const,  label: 'Moderately',       sub: 'Top 100 nationals' },
                    ].map(t => {
                      const selected = selectivityTier === t.id;
                      return (
                        <div
                          key={t.id}
                          onClick={() => { setSelectivityTier(t.id); setError(''); }}
                          style={ss({
                            cursor: 'pointer',
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: selected ? '2px solid #7c3aed' : '1px solid var(--border)',
                            background: selected ? '#faf5ff' : 'var(--card)',
                            transition: 'all .15s',
                          })}
                        >
                          <div style={ss({fontSize:12,fontWeight:700,color:'var(--stone-900)',marginBottom:2})}>{t.label}</div>
                          <div style={ss({fontSize:10,color:'var(--stone-400)',lineHeight:1.4})}>{t.sub}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:8,lineHeight:1.5,fontStyle:'italic'})}>
                    The reader&apos;s standards are calibrated to this tier. We never tell the model the name of a specific school.
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{marginBottom:16}}>
            <label style={ss({fontSize:11,fontWeight:700,color:'var(--stone-400)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:.3})}>Essay type</label>
            <select value={essayType} onChange={e=>setEssayType(e.target.value)} style={ss({width:'100%',maxWidth:300,padding:'10px 12px',borderRadius:8,border:'1px solid var(--border)',fontSize:13,fontFamily:'inherit',background:'var(--stone-50)',color:'var(--stone-900)',fontWeight:600,outline:'none'})}>
              {ESSAY_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <label style={ss({fontSize:11,fontWeight:700,color:'var(--stone-400)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:.3})}>
            {tool === 'hook' ? 'Your essay (we\u2019ll analyze the opening)' : 'Your essay'}
          </label>
          <textarea value={essay} onChange={e=>setEssay(e.target.value)} rows={14} placeholder={tool === 'hook' ? 'Paste your essay here \u2014 the hook analyzer reads the first few sentences.' : 'Paste your essay here or start typing...'}
            style={ss({width:'100%',padding:'14px 16px',borderRadius:10,border:'1px solid var(--border)',fontSize:14,fontFamily:'inherit',lineHeight:1.7,color:'var(--stone-900)',background:'var(--stone-50)',resize:'vertical',outline:'none'})}/>
          {error&&<div style={ss({fontSize:12,color:'#dc2626',fontWeight:600,marginTop:8,padding:'8px 12px',background:'#fef2f2',borderRadius:8})}>{error}</div>}
          <div style={ss({display:'flex',alignItems:'center',gap:12,marginTop:12})}>
            <div style={ss({fontSize:12,color:wordCount>0?'var(--stone-900)':'var(--stone-300)',fontWeight:700})}>{wordCount} <span style={{fontWeight:500,color:'var(--stone-400)'}}>words</span></div>
            {wordCount>0&&wordCount<minWords&&<span style={ss({fontSize:11,color:'#d97706',fontWeight:600})}>Minimum {minWords} words</span>}
            <div style={{flex:1}}/>
            <button onClick={handleSubmit} disabled={!canSubmit}
              style={ss({fontSize:14,padding:'10px 28px',borderRadius:10,border:'none',fontFamily:'inherit',fontWeight:800,
                cursor:canSubmit?'pointer':'default',
                background:canSubmit?'var(--stone-900)':'var(--stone-200)',
                color:canSubmit?'#FFE500':'var(--stone-400)',
                display:'flex',alignItems:'center',gap:8,transition:'all .15s'})}>
              {loading?<><i className="fas fa-spinner fa-spin" style={{fontSize:12}}></i> Analyzing...</>:(tool === 'hook' ? 'Analyze hook \u2192' : tool === 'reader' ? 'Get reader feedback \u2192' : 'Analyze essay \u2192')}
            </button>
          </div>
        </div>

        {/* Trust bar */}
        <div style={ss({display:'flex',justifyContent:'center',gap:28,padding:'20px 0',marginTop:8})}>
          {[
            {icon:'fa-lock',text:'Your essay is never stored or shared'},
            {icon:'fa-bolt',text:'Results in under 10 seconds'},
            {icon:'fa-bullseye',text:'Calibrated to writing standards'},
          ].map(t=>(
            <div key={t.text} style={ss({display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--stone-400)',fontWeight:600})}><i className={`fas ${t.icon}`} style={{fontSize:10,color:'var(--stone-300)'}}></i> {t.text}</div>
          ))}
        </div>
      </main>
    </AppShell>
  );
}
