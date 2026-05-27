'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

interface Dimension { name: string; score: number; feedback: string; quote: string; }
interface Annotation { text: string; type: 'strength' | 'weakness' | 'cliche'; note: string; }
interface ScoreResult {
  overall_score: number; overall_verdict: string; percentile: number; word_count: number;
  dimensions: Dimension[]; cliches_found: string[]; strongest_sentence: string;
  weakest_sentence: string; annotations: Annotation[]; improved_paragraph: string;
  top_3_improvements: string[]; remaining_scores: number;
}

const ESSAY_TYPES = ['Personal Statement','Why This School','Academic Interest','Activity / Interest','Personal Challenge','Program Specific'];

function scoreColor(s: number): string { return s >= 80 ? '#10b981' : s >= 65 ? '#3b82f6' : s >= 50 ? '#f59e0b' : '#ef4444'; }
function scoreLabel(s: number): string { return s >= 85 ? 'Exceptional' : s >= 72 ? 'Strong' : s >= 58 ? 'Developing' : s >= 45 ? 'Needs Work' : 'Significant Revision Needed'; }
function dimBarColor(s: number): string { return s >= 8 ? '#10b981' : s >= 6 ? '#3b82f6' : s >= 4 ? '#f59e0b' : '#ef4444'; }
function dimBadge(s: number): { bg: string; color: string; border: string } {
  if (s >= 8) return { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' };
  if (s >= 6) return { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' };
  if (s >= 4) return { bg: '#fffbeb', color: '#92400e', border: '#fde68a' };
  return { bg: '#fef2f2', color: '#991b1b', border: '#fecaca' };
}

function annotateEssay(text: string, annotations: Annotation[]): React.ReactNode[] {
  if (!annotations?.length) return [<span key="raw">{text}</span>];
  const sorted = [...annotations].map(a => ({ ...a, idx: text.indexOf(a.text) })).filter(a => a.idx !== -1).sort((a, b) => a.idx - b.idx || b.text.length - a.text.length);
  if (!sorted.length) return [<span key="raw">{text}</span>];
  const nodes: React.ReactNode[] = []; let cursor = 0; let key = 0;
  for (const ann of sorted) {
    if (ann.idx < cursor) continue;
    if (ann.idx > cursor) nodes.push(<span key={key++}>{text.slice(cursor, ann.idx)}</span>);
    const bg = ann.type === 'strength' ? 'rgba(16,185,129,.2)' : ann.type === 'cliche' ? 'rgba(239,68,68,.2)' : 'rgba(245,158,11,.2)';
    const borderColor = ann.type === 'strength' ? '#10b981' : ann.type === 'cliche' ? '#ef4444' : '#f59e0b';
    nodes.push(
      <span key={key++} title={ann.note}
        style={{background:bg,borderBottom:`2px solid ${borderColor}`,borderRadius:2,padding:'0 2px',cursor:'pointer',
          textDecoration:ann.type==='cliche'?'line-through':'none',textDecorationColor:ann.type==='cliche'?'#ef4444':undefined}}>
        {ann.text}
      </span>
    );
    cursor = ann.idx + ann.text.length;
  }
  if (cursor < text.length) nodes.push(<span key={key++}>{text.slice(cursor)}</span>);
  return nodes;
}

function ScoreRing({ score }: { score: number }) {
  const r = 54, circ = 2 * Math.PI * r, fill = (score / 100) * circ, color = scoreColor(score);
  return (
    <div style={{position:'relative',width:144,height:144,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <svg width="144" height="144" style={{transform:'rotate(-90deg)'}}>
        <circle cx="72" cy="72" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="10" />
        <circle cx="72" cy="72" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          style={{transition:'stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)'}} />
      </svg>
      <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
        <span style={{fontSize:36,fontWeight:900,color:'#fff',lineHeight:1}}>{score}</span>
        <span style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,.4)',marginTop:2}}>/100</span>
      </div>
    </div>
  );
}

const ss = (o: React.CSSProperties) => o;
const dark = '#0a0a0f';

export default function ScorePage() {
  const [essay, setEssay] = useState('');
  const [essayType, setEssayType] = useState('Personal Statement');
  const [collegeName, setCollegeName] = useState('');
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'annotated' | 'rubric' | 'improve'>('rubric');
  const resultRef = useRef<HTMLDivElement>(null);
  const wordCount = essay.trim() ? essay.trim().split(/\s+/).length : 0;

  async function handleScore() {
    if (!essay.trim() || wordCount < 50) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/essays/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ essay, essay_type: essayType, college_name: collegeName }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return; }
      setResult(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch { setError('Network error — please try again.'); } finally { setLoading(false); }
  }

  const inputDark = ss({background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.1)',borderRadius:16,padding:'10px 16px',fontSize:14,fontWeight:500,color:'rgba(255,255,255,.8)',outline:'none',fontFamily:'inherit',transition:'border-color .15s'});
  const card = ss({background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.1)',borderRadius:20,padding:24});

  return (
    <div style={ss({minHeight:'100vh',background:dark,color:'#fff',fontFamily:"'DM Sans','Inter',sans-serif"})}>

      {/* Nav */}
      <nav style={ss({borderBottom:'1px solid rgba(255,255,255,.1)',padding:'0 24px',height:56,display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:30,background:'rgba(10,10,15,.95)',backdropFilter:'blur(8px)'})}>
        <div style={ss({display:'flex',alignItems:'center',gap:10})}>
          <div style={ss({width:32,height:32,borderRadius:10,background:'var(--yellow)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900,fontSize:11,color:'#000'})}>DS</div>
          <span style={ss({fontWeight:800,fontSize:13,color:'rgba(255,255,255,.8)'})}>Essay Review</span>
          <span style={ss({fontSize:11,color:'rgba(255,255,255,.2)'})}>by Admitly</span>
        </div>
        <Link href="/essays" style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'7px 16px',background:'rgba(255,255,255,.1)',borderRadius:12,fontSize:12,fontWeight:700,color:'rgba(255,255,255,.7)',textDecoration:'none',transition:'background .12s'})}>
          <i className="fas fa-pen-nib" style={{fontSize:10}}></i> Essay Studio
          <span style={ss({background:'var(--yellow)',color:'#000',fontSize:9,fontWeight:900,padding:'2px 6px',borderRadius:10,marginLeft:4})}>PRO</span>
        </Link>
      </nav>

      <div style={ss({maxWidth:860,margin:'0 auto',padding:'40px 16px'})}>

        {/* Hero */}
        {!result && (
          <div style={ss({textAlign:'center',marginBottom:40})}>
            <div style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'6px 16px',background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.1)',borderRadius:20,fontSize:11,fontWeight:700,color:'rgba(255,255,255,.5)',marginBottom:24,textTransform:'uppercase',letterSpacing:'0.5px'})}>
              <span style={ss({width:6,height:6,borderRadius:'50%',background:'var(--yellow)'})}></span>
              Free · No account needed · 3 scores / hour
            </div>
            <h1 style={ss({fontSize:52,fontWeight:900,lineHeight:1.05,marginBottom:16})}>
              How good is<br /><span style={{color:'var(--yellow)'}}>your essay?</span>
            </h1>
            <p style={ss({color:'rgba(255,255,255,.4)',fontSize:17,fontWeight:500,maxWidth:460,margin:'0 auto',lineHeight:1.6})}>
              Paste it below. Get a detailed score, inline feedback on every paragraph, and a rewritten opening — instantly.
            </p>
          </div>
        )}

        {/* Input card */}
        {!result && (
          <div style={{...card,display:'flex',flexDirection:'column',gap:16}}>
            <div style={ss({display:'flex',gap:12,flexWrap:'wrap'})}>
              <select value={essayType} onChange={e => setEssayType(e.target.value)} style={{...inputDark,flex:1,minWidth:160}}>
                {ESSAY_TYPES.map(t => <option key={t} style={{background:'#1a1a2e'}}>{t}</option>)}
              </select>
              <input placeholder="College (optional) — e.g. Stanford" value={collegeName} onChange={e => setCollegeName(e.target.value)}
                style={{...inputDark,flex:1,minWidth:180}} />
            </div>
            <div style={ss({position:'relative'})}>
              <textarea rows={14} value={essay} onChange={e => setEssay(e.target.value)}
                placeholder="Paste your essay here — minimum 50 words, maximum 2,000…"
                style={{...inputDark,width:'100%',minHeight:280,resize:'none',lineHeight:1.8}} />
              <span style={ss({position:'absolute',bottom:14,right:14,fontSize:12,fontWeight:700,color:wordCount<50?'rgba(255,255,255,.2)':wordCount>1800?'#f59e0b':'rgba(255,255,255,.3)'})}>{wordCount} words</span>
            </div>
            {error && (
              <div style={ss({display:'flex',alignItems:'center',gap:10,padding:'10px 16px',background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.2)',borderRadius:14,color:'#f87171',fontSize:13,fontWeight:600})}>
                <i className="fas fa-exclamation-circle" style={{flexShrink:0}}></i> {error}
              </div>
            )}
            <button onClick={handleScore} disabled={loading || wordCount < 50}
              style={ss({width:'100%',padding:'16px 0',borderRadius:16,border:'none',fontFamily:'inherit',fontSize:15,fontWeight:900,cursor:(loading||wordCount<50)?'not-allowed':'pointer',transition:'all .12s',
                background:(loading||wordCount<50)?'rgba(255,255,255,.05)':'var(--yellow)',color:(loading||wordCount<50)?'rgba(255,255,255,.2)':'#000'})}>
              {loading ? <><i className="fas fa-spinner fa-spin" style={{marginRight:8}}></i>Analyzing your essay…</> :
                wordCount < 50 ? `Paste your essay above (${Math.max(0, 50 - wordCount)} more words needed)` :
                <><i className="fas fa-magnifying-glass" style={{marginRight:8}}></i>Score My Essay</>}
            </button>
            <p style={ss({textAlign:'center',fontSize:11,fontWeight:500,color:'rgba(255,255,255,.2)'})}>Your essay is sent to an AI model for analysis and is not stored by us.</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div ref={resultRef} style={ss({display:'flex',flexDirection:'column',gap:20})}>

            {/* Score hero */}
            <div style={{...card,display:'flex',alignItems:'center',gap:24,flexWrap:'wrap'}}>
              <ScoreRing score={result.overall_score} />
              <div style={ss({flex:1,minWidth:200})}>
                <div style={ss({fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.5px',color:'rgba(255,255,255,.3)',marginBottom:4})}>{essayType}{collegeName ? ` · ${collegeName}` : ''}</div>
                <div style={ss({fontSize:22,fontWeight:900,marginBottom:4,color:scoreColor(result.overall_score)})}>{scoreLabel(result.overall_score)}</div>
                <p style={ss({color:'rgba(255,255,255,.6)',fontWeight:500,fontSize:13,lineHeight:1.7,maxWidth:360})}>{result.overall_verdict}</p>
                <div style={ss({display:'flex',flexWrap:'wrap',gap:10,marginTop:16})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,.05)',borderRadius:12,padding:'6px 12px'})}>
                    <i className="fas fa-chart-bar" style={{color:'var(--yellow)',fontSize:10}}></i>
                    <span style={ss({fontSize:11,fontWeight:800,color:'rgba(255,255,255,.7)'})}>Top {100 - result.percentile}% of applicants</span>
                  </div>
                  <div style={ss({display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,.05)',borderRadius:12,padding:'6px 12px'})}>
                    <i className="fas fa-align-left" style={{color:'var(--yellow)',fontSize:10}}></i>
                    <span style={ss({fontSize:11,fontWeight:800,color:'rgba(255,255,255,.7)'})}>{result.word_count} words</span>
                  </div>
                  {result.cliches_found?.length > 0 && (
                    <div style={ss({display:'flex',alignItems:'center',gap:6,background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.2)',borderRadius:12,padding:'6px 12px'})}>
                      <i className="fas fa-triangle-exclamation" style={{color:'#f87171',fontSize:10}}></i>
                      <span style={ss({fontSize:11,fontWeight:800,color:'#f87171'})}>{result.cliches_found.length} cliché{result.cliches_found.length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={ss({display:'flex',flexDirection:'column',gap:8,flexShrink:0})}>
                <button onClick={() => { setResult(null); setError(''); }}
                  style={ss({display:'flex',alignItems:'center',gap:8,padding:'10px 16px',background:'rgba(255,255,255,.1)',borderRadius:12,border:'none',fontFamily:'inherit',fontSize:12,fontWeight:700,color:'rgba(255,255,255,.7)',cursor:'pointer'})}>
                  <i className="fas fa-rotate" style={{fontSize:10}}></i> Score another
                </button>
                <Link href="/essays"
                  style={ss({display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'10px 16px',background:'var(--yellow)',borderRadius:12,fontSize:12,fontWeight:900,color:'#000',textDecoration:'none'})}>
                  <i className="fas fa-pen-nib" style={{fontSize:10}}></i> Fix it in Studio
                </Link>
              </div>
            </div>

            {/* Tab bar */}
            <div style={ss({display:'flex',gap:6,background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.1)',padding:6,borderRadius:16})}>
              {([['rubric','fa-chart-bar','Score Breakdown'],['annotated','fa-highlighter','Annotated Essay'],['improve','fa-wand-magic-sparkles','Improvement Preview']] as const).map(([id,icon,label]) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  style={ss({flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'10px 0',borderRadius:12,border:'none',fontFamily:'inherit',fontSize:12,fontWeight:800,cursor:'pointer',transition:'all .12s',
                    background:activeTab===id?'#fff':'transparent',color:activeTab===id?'#1c1917':'rgba(255,255,255,.4)'})}>
                  <i className={`fas ${icon}`} style={{fontSize:10}}></i> {label}
                </button>
              ))}
            </div>

            {/* Rubric tab */}
            {activeTab === 'rubric' && (
              <div style={ss({display:'flex',flexDirection:'column',gap:12})}>
                {result.dimensions.map(dim => {
                  const b = dimBadge(dim.score);
                  return (
                    <div key={dim.name} style={card}>
                      <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:12})}>
                        <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                          <span style={ss({fontSize:11,fontWeight:800,padding:'4px 10px',borderRadius:10,background:b.bg,color:b.color,border:`1px solid ${b.border}`})}>{dim.score}/10</span>
                          <span style={ss({fontWeight:800,fontSize:14,color:'#fff'})}>{dim.name}</span>
                        </div>
                        <div style={ss({flex:1,maxWidth:120,height:8,background:'rgba(255,255,255,.1)',borderRadius:10,overflow:'hidden'})}>
                          <div style={{height:'100%',borderRadius:10,background:dimBarColor(dim.score),width:`${dim.score*10}%`,transition:'width .7s'}}></div>
                        </div>
                      </div>
                      <p style={ss({color:'rgba(255,255,255,.5)',fontSize:13,fontWeight:500,lineHeight:1.7})}>{dim.feedback}</p>
                      {dim.quote && (
                        <div style={ss({marginTop:12,display:'flex',alignItems:'flex-start',gap:8})}>
                          <i className="fas fa-quote-left" style={{color:'rgba(255,255,255,.15)',fontSize:10,marginTop:2,flexShrink:0}}></i>
                          <p style={ss({color:'rgba(255,255,255,.25)',fontSize:12,fontStyle:'italic',lineHeight:1.7})}>{dim.quote}</p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Top 3 improvements */}
                <div style={card}>
                  <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:16})}>
                    <i className="fas fa-arrow-trend-up" style={{color:'var(--yellow)'}}></i>
                    <span style={ss({fontWeight:800,fontSize:14,color:'#fff'})}>Top 3 Improvements</span>
                  </div>
                  <div style={ss({display:'flex',flexDirection:'column',gap:12})}>
                    {result.top_3_improvements?.map((imp, i) => (
                      <div key={i} style={ss({display:'flex',alignItems:'flex-start',gap:10})}>
                        <span style={ss({width:24,height:24,borderRadius:10,background:'rgba(255,229,0,.1)',border:'1px solid rgba(255,229,0,.2)',color:'var(--yellow)',fontSize:11,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2})}>{i+1}</span>
                        <p style={ss({color:'rgba(255,255,255,.6)',fontSize:13,fontWeight:500,lineHeight:1.7})}>{imp}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Best / worst */}
                <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:12})}>
                  <div style={ss({background:'rgba(16,185,129,.05)',border:'1px solid rgba(16,185,129,.2)',borderRadius:16,padding:16})}>
                    <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:8})}>
                      <i className="fas fa-star" style={{color:'#10b981',fontSize:11}}></i>
                      <span style={ss({fontSize:10,fontWeight:800,color:'#10b981',textTransform:'uppercase',letterSpacing:'0.3px'})}>Strongest Sentence</span>
                    </div>
                    <p style={ss({color:'rgba(255,255,255,.6)',fontSize:12,fontWeight:500,lineHeight:1.7,fontStyle:'italic'})}>"{result.strongest_sentence}"</p>
                  </div>
                  <div style={ss({background:'rgba(239,68,68,.05)',border:'1px solid rgba(239,68,68,.2)',borderRadius:16,padding:16})}>
                    <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:8})}>
                      <i className="fas fa-triangle-exclamation" style={{color:'#ef4444',fontSize:11}}></i>
                      <span style={ss({fontSize:10,fontWeight:800,color:'#ef4444',textTransform:'uppercase',letterSpacing:'0.3px'})}>Weakest Sentence</span>
                    </div>
                    <p style={ss({color:'rgba(255,255,255,.6)',fontSize:12,fontWeight:500,lineHeight:1.7,fontStyle:'italic'})}>"{result.weakest_sentence}"</p>
                  </div>
                </div>

                {result.cliches_found?.length > 0 && (
                  <div style={ss({background:'rgba(239,68,68,.05)',border:'1px solid rgba(239,68,68,.2)',borderRadius:16,padding:16})}>
                    <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:12})}>
                      <i className="fas fa-ban" style={{color:'#ef4444',fontSize:11}}></i>
                      <span style={ss({fontSize:10,fontWeight:800,color:'#ef4444',textTransform:'uppercase',letterSpacing:'0.3px'})}>Clichés to Cut</span>
                    </div>
                    <div style={ss({display:'flex',flexWrap:'wrap',gap:8})}>
                      {result.cliches_found.map((c, i) => (
                        <span key={i} style={ss({padding:'4px 12px',background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.2)',color:'#f87171',fontSize:12,fontWeight:700,borderRadius:10,textDecoration:'line-through'})}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Annotated tab */}
            {activeTab === 'annotated' && (
              <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                <div style={ss({display:'flex',flexWrap:'wrap',gap:12,fontSize:12,fontWeight:700})}>
                  <span style={ss({display:'flex',alignItems:'center',gap:6})}><span style={{width:12,height:12,borderRadius:2,background:'rgba(16,185,129,.2)',borderBottom:'2px solid #10b981',display:'inline-block'}}></span>Strength</span>
                  <span style={ss({display:'flex',alignItems:'center',gap:6})}><span style={{width:12,height:12,borderRadius:2,background:'rgba(245,158,11,.2)',borderBottom:'2px solid #f59e0b',display:'inline-block'}}></span>Weakness</span>
                  <span style={ss({display:'flex',alignItems:'center',gap:6})}><span style={{width:12,height:12,borderRadius:2,background:'rgba(239,68,68,.2)',borderBottom:'2px solid #ef4444',display:'inline-block'}}></span>Cliché</span>
                  <span style={ss({color:'rgba(255,255,255,.3)',fontWeight:400})}>— hover any highlight to see feedback</span>
                </div>
                <div style={card}>
                  <p style={ss({color:'rgba(255,255,255,.7)',fontSize:14,fontWeight:500,lineHeight:2,whiteSpace:'pre-wrap'})}>{annotateEssay(essay, result.annotations)}</p>
                </div>
              </div>
            )}

            {/* Improve tab */}
            {activeTab === 'improve' && (
              <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                <div style={ss({background:'rgba(255,229,0,.05)',border:'1px solid rgba(255,229,0,.2)',borderRadius:16,padding:16,display:'flex',alignItems:'flex-start',gap:12})}>
                  <i className="fas fa-wand-magic-sparkles" style={{color:'var(--yellow)',marginTop:2,flexShrink:0}}></i>
                  <div>
                    <div style={ss({fontSize:14,fontWeight:800,color:'#fff',marginBottom:4})}>Opening paragraph rewritten</div>
                    <p style={ss({color:'rgba(255,255,255,.4)',fontSize:12,fontWeight:500,lineHeight:1.7})}>
                      This shows what your opening could look like with professional editing. The full AI rewrite is available in <Link href="/essays" style={{color:'var(--yellow)',textDecoration:'none'}}>Essay Studio</Link>.
                    </p>
                  </div>
                </div>
                <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:16})}>
                  <div>
                    <div style={ss({fontSize:10,fontWeight:800,color:'rgba(255,255,255,.3)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8,display:'flex',alignItems:'center',gap:6})}>
                      <span style={{width:8,height:8,borderRadius:'50%',background:'#ef4444'}}></span> Your opening
                    </div>
                    <div style={card}><p style={ss({color:'rgba(255,255,255,.4)',fontSize:14,fontWeight:500,lineHeight:1.8,fontStyle:'italic'})}>{essay.split('\n\n')[0] || essay.split('\n')[0] || essay.slice(0, 400)}</p></div>
                  </div>
                  <div>
                    <div style={ss({fontSize:10,fontWeight:800,color:'rgba(255,229,0,.7)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8,display:'flex',alignItems:'center',gap:6})}>
                      <i className="fas fa-wand-magic-sparkles" style={{fontSize:9}}></i> AI-improved version
                    </div>
                    <div style={ss({background:'rgba(255,229,0,.05)',border:'1px solid rgba(255,229,0,.2)',borderRadius:20,padding:24})}>
                      <p style={ss({color:'rgba(255,255,255,.7)',fontSize:14,fontWeight:500,lineHeight:1.8})}>{result.improved_paragraph}</p>
                    </div>
                  </div>
                </div>
                <div style={ss({background:'linear-gradient(to right,rgba(37,99,235,.2),rgba(124,58,237,.2))',border:'1px solid rgba(59,130,246,.2)',borderRadius:20,padding:24,textAlign:'center'})}>
                  <div style={ss({fontSize:18,fontWeight:900,color:'#fff',marginBottom:4})}>Want the full essay rewritten?</div>
                  <p style={ss({color:'rgba(255,255,255,.4)',fontSize:13,fontWeight:500,marginBottom:16})}>Essay Studio uses your entire profile to generate a complete, grounded draft — not just the opening.</p>
                  <Link href="/essays" style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'12px 24px',background:'var(--yellow)',borderRadius:14,fontSize:14,fontWeight:900,color:'#000',textDecoration:'none'})}>
                    <i className="fas fa-pen-nib" style={{fontSize:12}}></i> Open Essay Studio
                  </Link>
                </div>
              </div>
            )}

            {result.remaining_scores !== undefined && (
              <p style={ss({textAlign:'center',fontSize:11,fontWeight:500,color:'rgba(255,255,255,.2)'})}>
                {result.remaining_scores > 0
                  ? `${result.remaining_scores} free score${result.remaining_scores !== 1 ? 's' : ''} remaining this hour`
                  : "You've used your free scores for this hour. Create an account for unlimited access."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
