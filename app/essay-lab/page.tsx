'use client';

import { useMemo, useState, type CSSProperties, type ClipboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AppShell } from '@/components/AppShell';

type ReaderRole = 'teacher' | 'admissions_officer';
type SelectivityTier = 'highly' | 'selective' | 'moderate';

interface ReaderResult {
  reader_role: ReaderRole;
  selectivity_tier?: SelectivityTier;
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

interface ToolTile {
  id: string;
  title: string;
  desc: string;
  foot: string;
  icon: string;
  tone: 'white' | 'yellow' | 'dark' | 'soft';
  shape: 'circle' | 'rect' | 'diamond' | 'triangle';
  wide?: boolean;
  large?: boolean;
  studio?: boolean;
  pro?: boolean;
}

const NAVY = '#06245B';
const YELLOW = '#FFE500';
const FREE_DAILY_LIMIT = 3;

export const dynamic = 'force-dynamic';

const knobStyle = (position: string) => ({ '--knob': position }) as CSSProperties;

const tileStyle = (id: string) => {
  const styles: Record<string, CSSProperties> = {
    reader: { '--tile-bg': '#ffffff', '--shape': '#edf4ff', '--dot': YELLOW } as CSSProperties,
    studio: { '--shape': 'rgba(255,229,0,.16)', '--dot': 'rgba(255,255,255,.18)' } as CSSProperties,
    thesis: { '--shape': 'rgba(6,36,91,.09)', '--dot': 'rgba(255,255,255,.72)' } as CSSProperties,
    outline: { '--shape': 'rgba(255,229,0,.16)', '--dot': 'rgba(255,255,255,.18)' } as CSSProperties,
    paragraph: { '--tile-bg': '#ffffff', '--shape': '#fff7cc', '--dot': '#edf4ff' } as CSSProperties,
    evidence: { '--tile-bg': '#f8fbff', '--shape': '#edf4ff', '--dot': YELLOW } as CSSProperties,
    conclusion: { '--shape': 'rgba(6,36,91,.08)', '--dot': 'rgba(255,255,255,.72)' } as CSSProperties,
    score: { '--shape': 'rgba(255,229,0,.15)', '--dot': 'rgba(255,255,255,.16)' } as CSSProperties,
    'prompt-fit': { '--tile-bg': '#ffffff', '--shape': '#fff7cc', '--dot': '#edf4ff' } as CSSProperties,
  };

  return styles[id] ?? {};
};

const TOOLS: ToolTile[] = [
  {
    id: 'reader',
    title: 'Reader Simulator',
    desc: 'See how your essay may land with a school teacher.',
    foot: 'Most-used free tool',
    icon: 'fa-headphones-simple',
    tone: 'white',
    shape: 'circle',
    large: true,
  },
  {
    id: 'studio',
    title: 'Essay Studio',
    desc: 'Full drafting workspace with voice, journey, and review controls.',
    foot: 'Premium workspace',
    icon: 'fa-sliders',
    tone: 'dark',
    shape: 'rect',
    studio: true,
    pro: true,
  },
  {
    id: 'thesis',
    title: 'Thesis Checker',
    desc: 'Check clarity, focus, and argument strength.',
    foot: 'Fast check',
    icon: 'fa-magnifying-glass',
    tone: 'yellow',
    shape: 'triangle',
  },
  {
    id: 'outline',
    title: 'Outline Builder',
    desc: 'Turn a prompt into a clean essay plan.',
    foot: 'Start draft',
    icon: 'fa-list',
    tone: 'dark',
    shape: 'rect',
    wide: true,
  },
  {
    id: 'paragraph',
    title: 'Paragraph Fixer',
    desc: 'Improve clarity, grammar, and flow.',
    foot: 'Quick polish',
    icon: 'fa-wand-magic-sparkles',
    tone: 'white',
    shape: 'diamond',
  },
  {
    id: 'evidence',
    title: 'Evidence Checker',
    desc: 'Find claims that need stronger support.',
    foot: 'Rubric help',
    icon: 'fa-shield-halved',
    tone: 'soft',
    shape: 'circle',
  },
  {
    id: 'conclusion',
    title: 'Conclusion Checker',
    desc: 'Make sure your ending lands cleanly.',
    foot: 'Final pass',
    icon: 'fa-flag-checkered',
    tone: 'yellow',
    shape: 'rect',
  },
  {
    id: 'score',
    title: 'Full Essay Score',
    desc: 'Detailed rubric score with comments.',
    foot: 'Advanced review',
    icon: 'fa-chart-simple',
    tone: 'dark',
    shape: 'diamond',
    wide: true,
    pro: true,
  },
  {
    id: 'prompt-fit',
    title: 'Prompt Fit',
    desc: 'Check whether your draft answers the prompt.',
    foot: 'High-stakes',
    icon: 'fa-check',
    tone: 'white',
    shape: 'triangle',
    pro: true,
  },
];

function wordsFrom(text: string) {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

function clampWords(text: string, limit: number) {
  return wordsFrom(text).slice(0, limit).join(' ');
}

function scoreToGrade(score: number) {
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 60) return 'D';
  return 'Needs work';
}

function tileShapePath(shape: ToolTile['shape']) {
  if (shape === 'circle') return <circle cx="50" cy="50" r="42" />;
  if (shape === 'diamond') return <path d="M50 0 100 50 50 100 0 50Z" />;
  if (shape === 'triangle') return <polygon points="50,0 100,100 0,100" />;
  return <rect x="10" y="10" width="80" height="80" rx="20" />;
}

function renderTileArt(id: string) {
  if (id === 'reader') {
    return (
      <div className="tileViz readerViz">
        <div className="feedbackCard">
          <span />
          <span />
          <b />
        </div>
        <div className="miniBars">
          <i style={{ height: 14 }} />
          <i style={{ height: 28 }} />
          <i style={{ height: 20 }} />
        </div>
      </div>
    );
  }
  if (id === 'studio') {
    return (
      <div className="tileViz studioViz">
        <div className="sliderArt">
          <div className="slider" style={knobStyle('72%')}><span style={{ width: '72%' }} /></div>
          <div className="slider" style={knobStyle('48%')}><span style={{ width: '48%' }} /></div>
          <div className="slider" style={knobStyle('84%')}><span style={{ width: '84%' }} /></div>
        </div>
        <div className="studioSpark"><i /><i /><i /></div>
      </div>
    );
  }
  if (id === 'outline') {
    return (
      <div className="tileViz outlineViz">
        <div className="nodeChart"><span /><span /><span /></div>
        <div className="outlineLines"><i /><i /><i /></div>
      </div>
    );
  }
  if (id === 'paragraph') {
    return (
      <div className="tileViz paragraphViz">
        <div className="rewriteCard">
          <span />
          <span />
          <b />
        </div>
      </div>
    );
  }
  if (id === 'score') {
    return (
      <div className="tileViz scoreViz">
        <div className="scoreRing"><span>92</span></div>
        <div className="miniBars">
          <i style={{ height: 11 }} />
          <i style={{ height: 22 }} />
          <i style={{ height: 16 }} />
        </div>
      </div>
    );
  }
  if (id === 'thesis') {
    return (
      <div className="tileViz thesisViz">
        <div className="targetMark"><span /><b /></div>
        <em>Clear</em>
      </div>
    );
  }
  if (id === 'evidence') {
    return (
      <div className="tileViz evidenceViz">
        <div className="checkStack">
          <span><i /></span>
          <span><i /></span>
          <span />
        </div>
      </div>
    );
  }
  if (id === 'conclusion') {
    return (
      <div className="tileViz conclusionViz">
        <div className="flagMark"><span /><b /></div>
        <em>Land it</em>
      </div>
    );
  }
  if (id === 'prompt-fit') {
    return (
      <div className="tileViz promptViz">
        <div className="promptCard">
          <span />
          <span />
          <b />
        </div>
      </div>
    );
  }
  return null;
}

function renderToolIcon(id: string) {
  const common = { fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24', strokeWidth: 2.2 } as const;
  if (id === 'reader') {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5v6A2.5 2.5 0 0 0 5.5 19h3.2c.45 0 .8-.36.8-.8V9.8c0-.44-.35-.8-.8-.8H5.5A2.5 2.5 0 0 0 3 11.5Zm18 0v6a2.5 2.5 0 0 1-2.5 2.5h-3.2a.8.8 0 0 1-.8-.8V9.8c0-.44.35-.8.8-.8h3.2a2.5 2.5 0 0 1 2.5 2.5ZM9.5 12h5M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm8 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      </svg>
    );
  }
  if (id === 'studio') {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h8M16 17h4M14 5v4M7 10v4M12 15v4" />
      </svg>
    );
  }
  if (id === 'thesis') {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.2-5.2m0 0A7.5 7.5 0 1 0 5.2 5.2a7.5 7.5 0 0 0 10.6 10.6Z" />
      </svg>
    );
  }
  if (id === 'outline') {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.75h16M4 12h16M4 17.25h16" />
      </svg>
    );
  }
  if (id === 'paragraph') {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.8 15.9 9 18.75l-.8-2.85a4.5 4.5 0 0 0-3.1-3.08L2.25 12l2.85-.82a4.5 4.5 0 0 0 3.1-3.08L9 5.25l.8 2.85a4.5 4.5 0 0 0 3.1 3.08l2.85.82-2.85.82a4.5 4.5 0 0 0-3.1 3.08ZM18 9.75l-.26-1.04a3.38 3.38 0 0 0-2.45-2.45L14.25 6l1.04-.26a3.38 3.38 0 0 0 2.45-2.45L18 2.25l.26 1.04a3.38 3.38 0 0 0 2.45 2.45L21.75 6l-1.04.26a3.38 3.38 0 0 0-2.45 2.45Z" />
      </svg>
    );
  }
  if (id === 'evidence') {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.63a2.25 2.25 0 0 0-1.32-2.05l-4.5-2.04a2.25 2.25 0 0 0-1.86 0l-4.5 2.04A2.25 2.25 0 0 0 6 11.62v2.63m13.5 0a7.5 7.5 0 0 1-15 0m15 0H4.5" />
      </svg>
    );
  }
  if (id === 'conclusion') {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75h15M4.5 12h15M4.5 17.25H12" />
      </svg>
    );
  }
  if (id === 'score') {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6 6 0 0 0 1.5-.19m-1.5.19a6 6 0 0 1-1.5-.19m3.75 7.48a12 12 0 0 1-4.5 0M14.25 18v-.2c0-.98.66-1.82 1.51-2.31a7.5 7.5 0 1 0-7.52 0c.85.49 1.51 1.33 1.51 2.31v.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

export default function EssayLabPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isPro = (session?.user as any)?.subscription_status === 'pro' || (session?.user as any)?.subscription_status === 'premium';

  const [selectedTool, setSelectedTool] = useState('reader');
  const [readerRole, setReaderRole] = useState<ReaderRole>('teacher');
  const [prompt, setPrompt] = useState('Explain how a challenge shaped your perspective with clear evidence and reflection.');
  const [essay, setEssay] = useState('When I joined the robotics team, I thought my job was to be the person with the best ideas. At our first competition, our robot stopped moving during the second round, and I kept suggesting fixes before listening to anyone else. My teammate Maya finally asked me to stop talking and check the wiring with her. We found a loose connector in three minutes. That moment taught me that leadership is not always being the loudest person in the room. Sometimes it is slowing down enough to help the team think clearly.');
  const [result, setResult] = useState<ReaderResult | null>(null);
  const [activePane, setActivePane] = useState<'input' | 'output'>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);

  const promptWords = useMemo(() => wordsFrom(prompt).length, [prompt]);
  const essayWords = useMemo(() => wordsFrom(essay).length, [essay]);
  const freeLeft = remaining ?? FREE_DAILY_LIMIT;
  const canRun = essayWords >= 50 && !loading && selectedTool === 'reader';

  function setLimitedPrompt(value: string) {
    setPrompt(clampWords(value, 100));
  }

  function setLimitedEssay(value: string) {
    setEssay(clampWords(value, 1500));
  }

  function handleLimitedPaste(event: ClipboardEvent<HTMLTextAreaElement>, limit: number, setter: (value: string) => void, currentValue: string) {
    const pasted = event.clipboardData.getData('text/plain');
    if (!pasted) return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart ?? currentValue.length;
    const end = target.selectionEnd ?? currentValue.length;
    setter(clampWords(`${currentValue.slice(0, start)}${pasted}${currentValue.slice(end)}`, limit));
  }

  function selectTool(tool: ToolTile) {
    if (tool.id === 'studio') {
      router.push('/essays');
      return;
    }
    setSelectedTool(tool.id);
    if (tool.id !== 'reader') {
      setError(`${tool.title} is coming soon. Reader Simulator is ready today.`);
      setActivePane('input');
      return;
    }
    setError('');
  }

  function chooseReaderRole(role: ReaderRole) {
    if (role === 'admissions_officer' && !isPro) {
      setError('Admissions Officer Simulator is a Pro tool. Teacher Simulator is free with a daily limit.');
      return;
    }
    setReaderRole(role);
    setError('');
  }

  async function runReader() {
    if (!canRun) {
      setError(essayWords < 50 ? 'Paste at least 50 words so the reader has enough to evaluate.' : 'Reader Simulator is the active free tool.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/essays/reader-simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          essay,
          essay_type: prompt.trim() || 'Personal Statement',
          reader_role: readerRole,
          selectivity_tier: 'selective',
        }),
      });
      const data = await response.json();

      if (response.status === 429 && data?.upgrade) {
        setRemaining(0);
        setError(data.error ?? 'You have used all free essay checks today.');
        return;
      }
      if (!response.ok) {
        setError(data?.error ?? 'Something went wrong with the AI review engine. Please try again later.');
        return;
      }

      setResult(data);
      if (typeof data.remaining_scores === 'number') setRemaining(data.remaining_scores);
      setActivePane('output');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function chooseTool(id: string) {
    const tool = TOOLS.find(item => item.id === id);
    if (tool) selectTool(tool);
  }

  const isOutputOpen = activePane === 'output';
  const outputTitle = readerRole === 'teacher' ? 'Teacher readiness' : 'Admissions read';
  const grade = result ? scoreToGrade(result.overall_score) : 'Ready';

  return (
    <AppShell>
      <main className="essayLabPage">
        <header className="labHeader">
          <div>
            <h1>Essay Lab</h1>
            <p>Pick an essay tool first. Launch only when you&apos;re ready to tune options and paste your draft.</p>
          </div>
        </header>

        <section className="labShell">
          <section className="toolLevel">
            <div className="levelTitle">
              <h2>1. Choose a Tool</h2>
              <div className="limitPill"><b>{isPro ? '∞' : freeLeft}</b>{isPro ? 'unlimited Pro checks' : 'free checks left today'}</div>
            </div>

            <div className="toolsShell">
              <div className="tools">
                <button type="button" className={`tool large ${selectedTool === 'reader' ? 'active' : ''}`} style={tileStyle('reader')} onClick={() => chooseTool('reader')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><circle cx="50" cy="50" r="50" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('reader')}</span>
                  </div>
                  <div className="tool-body">
                    <h3>Reader Simulator</h3>
                    <p>See how your essay may land with a school teacher.</p>
                    <div className="tile-art">
                      <div className="bubble">First impression</div>
                      <div className="bar-chart">
                        <div className="bar" style={{ height: 18 }} />
                        <div className="bar" style={{ height: 32 }} />
                        <div className="bar" style={{ height: 24 }} />
                      </div>
                    </div>
                  </div>
                  <div className="tool-foot">Most-used free tool</div>
                </button>

                <button type="button" className="tool studio" style={tileStyle('studio')} onClick={() => chooseTool('studio')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><rect x="9" y="9" width="82" height="82" rx="24" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('studio')}</span>
                    <span className="pill pro lock">PRO</span>
                  </div>
                  <div className="tool-body">
                    <h3>Essay Studio</h3>
                    <p>Full drafting workspace with voice, journey, and review controls.</p>
                    <div className="tile-art">
                      <div className="slider-art">
                        <div className="slider" style={knobStyle('72%')}><span style={{ width: '72%' }} /></div>
                        <div className="slider" style={knobStyle('48%')}><span style={{ width: '48%' }} /></div>
                        <div className="slider" style={knobStyle('84%')}><span style={{ width: '84%' }} /></div>
                      </div>
                    </div>
                  </div>
                  <div className="tool-foot">Premium workspace</div>
                </button>

                <button type="button" className={`tool yellow ${selectedTool === 'thesis' ? 'active' : ''}`} style={tileStyle('thesis')} onClick={() => chooseTool('thesis')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><polygon points="50,0 100,100 0,100" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('thesis')}</span>
                  </div>
                  <div className="tool-body">
                    <h3>Thesis Checker</h3>
                    <p>Check clarity, focus, and argument strength.</p>
                    <div className="tile-art"><div className="bubble">Clear?</div></div>
                  </div>
                  <div className="tool-foot">Fast check</div>
                </button>

                <button type="button" className={`tool dark wide ${selectedTool === 'outline' ? 'active' : ''}`} style={tileStyle('outline')} onClick={() => chooseTool('outline')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><rect x="10" y="10" width="80" height="80" rx="20" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('outline')}</span>
                  </div>
                  <div className="tool-body">
                    <h3>Outline Builder</h3>
                    <p>Turn a prompt into a simple essay plan.</p>
                    <div className="tile-art">
                      <div className="node-chart"><div className="node" /><div className="node" /><div className="node" /></div>
                    </div>
                  </div>
                  <div className="tool-foot">Start draft</div>
                </button>

                <button type="button" className={`tool ${selectedTool === 'paragraph' ? 'active' : ''}`} style={tileStyle('paragraph')} onClick={() => chooseTool('paragraph')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M50 0 100 50 50 100 0 50Z" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('paragraph')}</span>
                  </div>
                  <div className="tool-body">
                    <h3>Paragraph Fixer</h3>
                    <p>Improve clarity, grammar, and flow.</p>
                    <div className="tile-art">
                      <div className="bar-chart">
                        <div className="bar" style={{ height: 14 }} />
                        <div className="bar" style={{ height: 26 }} />
                        <div className="bar" style={{ height: 40 }} />
                      </div>
                      <div className="bubble">Polished</div>
                    </div>
                  </div>
                  <div className="tool-foot">Quick polish</div>
                </button>

                <button type="button" className={`tool ${selectedTool === 'evidence' ? 'active' : ''}`} style={tileStyle('evidence')} onClick={() => chooseTool('evidence')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><circle cx="50" cy="50" r="42" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('evidence')}</span>
                  </div>
                  <div className="tool-body">
                    <h3>Evidence Checker</h3>
                    <p>Find claims that need stronger support.</p>
                    <div className="tile-art"><div className="bubble">Proof gap</div></div>
                  </div>
                  <div className="tool-foot">Rubric help</div>
                </button>

                <button type="button" className={`tool yellow ${selectedTool === 'conclusion' ? 'active' : ''}`} style={tileStyle('conclusion')} onClick={() => chooseTool('conclusion')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><rect x="12" y="12" width="76" height="76" rx="18" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('conclusion')}</span>
                  </div>
                  <div className="tool-body">
                    <h3>Conclusion Checker</h3>
                    <p>Make sure your ending lands cleanly.</p>
                    <div className="tile-art"><div className="bubble">Last line</div></div>
                  </div>
                  <div className="tool-foot">Final pass</div>
                </button>

                <button type="button" className={`tool dark wide ${selectedTool === 'score' ? 'active' : ''}`} style={tileStyle('score')} onClick={() => chooseTool('score')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M50 0 100 50 50 100 0 50Z" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('score')}</span>
                    <span className="pill pro lock">PRO</span>
                  </div>
                  <div className="tool-body">
                    <h3>Full Essay Score</h3>
                    <p>Detailed rubric score with comments.</p>
                    <div className="tile-art">
                      <div className="score-ring"><span>92</span></div>
                      <div className="bubble">Rubric</div>
                    </div>
                  </div>
                  <div className="tool-foot">Advanced review</div>
                </button>

                <button type="button" className={`tool ${selectedTool === 'prompt-fit' ? 'active' : ''}`} style={tileStyle('prompt-fit')} onClick={() => chooseTool('prompt-fit')}>
                  <svg className="bg-graphic" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><polygon points="50,0 100,100 0,100" /></svg>
                  <div className="tool-top">
                    <span className="icon">{renderToolIcon('prompt-fit')}</span>
                    <span className="pill pro lock">PRO</span>
                  </div>
                  <div className="tool-body">
                    <h3>Prompt Fit</h3>
                    <p>Check whether your draft answers the prompt.</p>
                    <div className="tile-art"><div className="bubble">Missing ask?</div></div>
                  </div>
                  <div className="tool-foot">High-stakes</div>
                </button>
              </div>
            </div>
          </section>

          <section className="launchArea">
            <aside className="infoPane">
              <div className="staticTitle">
                <div className="staticIcon">TR</div>
                <div>
                  <h2>Reader Simulator</h2>
                  <p>Preview how a real reader may react to your essay.</p>
                </div>
              </div>

              <div className="readerSwitch" aria-label="Reader mode selector">
                <button type="button" className={readerRole === 'teacher' ? 'active' : ''} onClick={() => chooseReaderRole('teacher')}>Teacher</button>
                <button type="button" className={readerRole === 'admissions_officer' ? 'active proMode' : 'proMode'} onClick={() => chooseReaderRole('admissions_officer')}>
                  Admissions {!isPro && <b>PRO</b>}
                </button>
              </div>

              <p className="staticCopy">Teacher Review previews how a school essay may land with a classroom reader. It focuses on first impression, rubric risks, and the fixes that make the draft feel ready.</p>

              <div className="miniStack">
                <div className="miniRow"><b>Reader</b> High school teacher review for class essays.</div>
                <div className="miniRow"><b>Strictness</b> Balanced feedback with practical comments.</div>
                <div className="miniRow"><b>Output</b> First impression, concerns, and top fixes.</div>
              </div>

              {!isPro && (
                <button className="upgradeCard" type="button" onClick={() => router.push('/subscribe')}>
                  <span><i className="fas fa-lock" /></span>
                  <strong>Unlock Admissions Simulator</strong>
                  <small>Compare how a college reader reacts to your essay.</small>
                </button>
              )}
            </aside>

            <section className={`rightAccordion ${isOutputOpen ? 'outputOpen' : 'inputOpen'}`}>
              <article className="workAcc inputPanel">
                <button type="button" className="workHead" onClick={() => setActivePane('input')}>
                  <span className="workNum">1</span>
                  <span className="workTitle">
                    <strong>Essay Input</strong>
                    <small>Paste the prompt and essay, then run the reader.</small>
                  </span>
                  <span className="workState">{essayWords} / 1500 words</span>
                </button>

                <div className="workBody">
                  <label className="promptStrip">
                    <b>Optional prompt:</b>
                    <textarea
                      value={prompt}
                      onChange={event => setLimitedPrompt(event.target.value)}
                      onPaste={event => handleLimitedPaste(event, 100, setLimitedPrompt, prompt)}
                    />
                    <small>{promptWords} / 100 words</small>
                  </label>

                  <textarea
                    className="essayInput"
                    value={essay}
                    onChange={event => setLimitedEssay(event.target.value)}
                    onPaste={event => handleLimitedPaste(event, 1500, setLimitedEssay, essay)}
                    placeholder="Paste or write your essay here. Reader Simulator will preview how it may land with a high school teacher."
                  />

                  {error && <div className="errorBanner"><i className="fas fa-circle-exclamation" /> {error}</div>}

                  <div className="actions">
                    <p>Uses one free daily check. Results expand in the output panel.</p>
                    {loading && <span className="loadingDots">Reading draft</span>}
                    <button className="runButton" type="button" onClick={runReader} disabled={!canRun}>
                      {loading ? 'Running...' : result ? 'Run again' : 'Run Reader Simulator'}
                    </button>
                  </div>
                </div>
              </article>

              <article className="workAcc outputPanel">
                <button type="button" className="workHead" onClick={() => setActivePane('output')}>
                  <span className="workNum">2</span>
                  <span className="workTitle">
                    <strong>{outputTitle}</strong>
                    <small>{result ? 'View generated feedback.' : 'View teacher-style feedback.'}</small>
                  </span>
                  <span className="workState">{result ? 'Complete' : 'Ready'}</span>
                </button>

                <div className="workBody outputBody">
                  <div className="readiness">
                    <div>
                      <span>2. {outputTitle}</span>
                      <h3>{result?.verdict_sentence ?? 'Run the reader to generate a result'}</h3>
                      <p>{result?.first_impression ?? 'Teacher-style feedback will appear here after the draft is reviewed.'}</p>
                    </div>
                    <b>{grade}</b>
                  </div>

                  <div className="outputGrid">
                    <div className="outputChip wide">
                      <h3>First impression</h3>
                      <p>{result?.first_impression ?? 'The first read will summarize what stands out immediately.'}</p>
                    </div>
                    <div className="outputChip">
                      <h3>What feels strongest</h3>
                      <p>{result?.key_strengths?.join(' ') || 'Strengths will appear after analysis.'}</p>
                    </div>
                    <div className="outputChip">
                      <h3>What may cost points</h3>
                      <p>{result?.key_concerns?.join(' ') || 'Risks and concerns will appear after analysis.'}</p>
                    </div>
                    <div className="outputChip wide">
                      <h3>Top fixes</h3>
                      <p>{result ? `${result.would_remember} ${result.question_for_student}` : 'A short revision path will appear here.'}</p>
                    </div>
                  </div>
                </div>
              </article>
            </section>
          </section>
        </section>

        <style jsx>{`
          .essayLabPage {
            flex: 1;
            overflow-y: auto;
            padding: 28px;
            background:
              radial-gradient(circle at 92% 4%, rgba(255,229,0,.18), transparent 24%),
              linear-gradient(180deg, #f7faff 0%, #f4f7fb 100%);
            color: #102033;
          }

          .labHeader {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            margin-bottom: 18px;
            max-width: 1440px;
          }

          .labHeader h1 {
            margin: 0;
            color: ${NAVY};
            font-size: 34px;
            line-height: 1.05;
            letter-spacing: 0;
            font-weight: 900;
          }

          .labHeader p {
            margin: 7px 0 0;
            color: #64748b;
            font-size: 14px;
            font-weight: 700;
          }

          .labShell {
            max-width: 1440px;
            border: 1px solid #e2e8f0;
            border-radius: 24px;
            background: rgba(255,255,255,.94);
            box-shadow: 0 22px 60px rgba(15, 23, 42, .08);
            overflow: hidden;
          }

          .toolLevel {
            padding: 20px;
            border-bottom: 1px solid #e2e8f0;
          }

          .levelTitle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 14px;
          }

          .levelTitle h2 {
            margin: 0;
            color: ${NAVY};
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: .45px;
            font-weight: 900;
          }

          .limitPill {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 8px 13px;
            border: 1px solid #e2e8f0;
            border-radius: 999px;
            background: rgba(255,255,255,.92);
            color: ${NAVY};
            font-size: 12px;
            font-weight: 900;
            white-space: nowrap;
          }

          .limitPill b {
            width: 28px;
            height: 28px;
            border-radius: 999px;
            display: grid;
            place-items: center;
            background: ${YELLOW};
          }

          .toolsShell {
            position: relative;
            overflow: hidden;
            border-radius: 20px;
            background:
              linear-gradient(135deg, rgba(255,255,255,.97), rgba(248,251,255,.97)),
              radial-gradient(circle at 92% 12%, rgba(255,229,0,.24), transparent 26%);
            border: 1px solid #dfe7f2;
            padding: 15px;
          }

          .toolsShell::before {
            content: "";
            position: absolute;
            left: -42px;
            bottom: -68px;
            width: 190px;
            height: 190px;
            border-radius: 50%;
            border: 24px solid rgba(6,36,91,.045);
            pointer-events: none;
          }

          .tools {
            position: relative;
            z-index: 1;
            display: flex;
            gap: 12px;
            overflow-x: auto;
            padding: 3px 0 8px;
            scrollbar-width: thin;
          }

          .tool {
            position: relative;
            overflow: hidden;
            flex: 0 0 142px;
            min-height: 142px;
            border: 1px solid rgba(6,36,91,.12);
            border-radius: 20px;
            background: var(--tile-bg, #fff);
            padding: 13px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            cursor: pointer;
            text-align: left;
            font-family: inherit;
            color: ${NAVY};
            transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
          }

          .tool.large { flex-basis: 184px; }
          .tool.wide { flex-basis: 176px; }

          .tool.studio {
            flex-basis: 276px;
            background: linear-gradient(135deg, ${NAVY} 0%, #0b347d 58%, #102f66 100%);
            color: #fff;
            border-color: transparent;
            box-shadow: 0 18px 42px rgba(6,36,91,.18);
          }

          .tool.dark {
            background: ${NAVY};
            color: #fff;
            border-color: transparent;
          }

          .tool.yellow {
            background: ${YELLOW};
            border-color: rgba(6,36,91,.13);
          }

          .tool::after {
            content: "";
            position: absolute;
            right: -22px;
            bottom: -22px;
            width: 82px;
            height: 82px;
            border-radius: 28px;
            background: var(--shape, rgba(6,36,91,.06));
            transform: rotate(12deg);
            opacity: .95;
          }

          .tool::before {
            content: "";
            position: absolute;
            right: 12px;
            bottom: 12px;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: var(--dot, rgba(255,255,255,.55));
            opacity: .6;
          }

          .tool.active {
            border-color: ${NAVY};
            box-shadow: 0 18px 42px rgba(6,36,91,.16), 0 0 0 4px rgba(6,36,91,.05);
            transform: translateY(-2px);
          }

          .tool-top,
          .tool-body,
          .tool-foot,
          .tile-art,
          .bg-graphic {
            position: relative;
            z-index: 1;
          }

          .tool-top {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
          }

          .icon {
            width: 32px;
            height: 32px;
            border-radius: 11px;
            background: rgba(255,255,255,.68);
            color: ${NAVY};
            display: grid;
            place-items: center;
            font-size: 12px;
            font-weight: 950;
            border: 1px solid rgba(6,36,91,.08);
            box-shadow: 0 8px 20px rgba(15,23,42,.06);
          }

          .icon svg {
            width: 17px;
            height: 17px;
          }

          .tool.dark .icon,
          .tool.studio .icon {
            background: rgba(255,255,255,.13);
            color: #fff;
          }

          .pill {
            position: relative;
            border-radius: 999px;
            padding: 5px 8px;
            background: ${YELLOW};
            color: ${NAVY};
            font-size: 9px;
            font-weight: 950;
            white-space: nowrap;
          }

          .pill.pro {
            background: ${NAVY};
            color: #fff;
          }

          .pill.lock {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding-left: 20px;
          }

          .pill.lock::before {
            content: "";
            position: absolute;
            left: 8px;
            top: 10px;
            width: 8px;
            height: 7px;
            border: 1.8px solid currentColor;
            border-radius: 2px;
            box-sizing: border-box;
          }

          .pill.lock::after {
            content: "";
            position: absolute;
            left: 8.5px;
            top: 5px;
            width: 7px;
            height: 6px;
            border: 1.8px solid currentColor;
            border-bottom: 0;
            border-radius: 6px 6px 0 0;
            box-sizing: border-box;
          }

          .tool.dark .pill.pro,
          .tool.studio .pill.pro {
            background: ${YELLOW};
            color: ${NAVY};
          }

          .tool h3 {
            margin: 10px 0 4px;
            color: ${NAVY};
            font-size: 14px;
            line-height: 1.15;
            letter-spacing: 0;
            font-weight: 900;
          }

          .tool p {
            margin: 0;
            color: #64748b;
            font-size: 10px;
            line-height: 1.3;
            font-weight: 700;
          }

          .tool.dark h3,
          .tool.dark p,
          .tool.dark .tool-foot,
          .tool.studio h3,
          .tool.studio p,
          .tool.studio .tool-foot {
            color: #fff;
          }

          .tool.dark p,
          .tool.dark .tool-foot,
          .tool.studio p,
          .tool.studio .tool-foot {
            opacity: .78;
          }

          .tool.yellow h3,
          .tool.yellow p,
          .tool.yellow .tool-foot {
            color: ${NAVY};
          }

          .tool-foot {
            color: #8491a3;
            font-size: 10px;
            font-weight: 900;
          }

          .tile-art {
            margin-top: auto;
            padding-top: 9px;
            display: flex;
            align-items: flex-end;
            gap: 6px;
            min-height: 35px;
          }

          .bar-chart {
            display: flex;
            align-items: flex-end;
            gap: 4px;
            height: 28px;
          }

          .bar {
            width: 9px;
            border-radius: 999px 999px 4px 4px;
            background: ${NAVY};
            opacity: .9;
          }

          .tool.dark .bar {
            background: ${YELLOW};
          }

          .bubble {
            border-radius: 12px;
            background: rgba(255,255,255,.78);
            border: 1px solid rgba(6,36,91,.08);
            padding: 5px 7px;
            color: ${NAVY};
            font-size: 9px;
            line-height: 1.25;
            font-weight: 900;
            box-shadow: 0 8px 20px rgba(15,23,42,.07);
          }

          .tool.dark .bubble,
          .tool.studio .bubble {
            background: rgba(255,255,255,.12);
            color: #fff;
            border-color: rgba(255,255,255,.16);
          }

          .slider-art {
            display: grid;
            gap: 8px;
            width: 100%;
            max-width: 150px;
          }

          .node-chart {
            display: flex;
            align-items: center;
            gap: 6px;
            padding-left: 2px;
          }

          .node {
            position: relative;
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: ${YELLOW};
            box-shadow: 0 0 0 4px rgba(255,229,0,.18);
          }

          .node::after {
            content: "";
            position: absolute;
            top: 4px;
            left: 9px;
            width: 13px;
            height: 2px;
            border-radius: 999px;
            background: rgba(255,229,0,.45);
          }

          .node:last-child::after {
            display: none;
          }

          .score-ring {
            position: relative;
            width: 31px;
            height: 31px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            background: conic-gradient(${YELLOW} 0 330deg, rgba(255,255,255,.15) 0);
            color: #fff;
            font-size: 11px;
            font-weight: 950;
          }

          .score-ring::before {
            content: "";
            position: absolute;
            inset: 5px;
            border-radius: inherit;
            background: ${NAVY};
          }

          .score-ring span {
            position: relative;
            z-index: 1;
            color: ${YELLOW};
          }

          .bg-graphic {
            position: absolute;
            right: -18px;
            bottom: -19px;
            width: 82px;
            height: 82px;
            color: var(--shape, rgba(6,36,91,.07));
            opacity: .75;
            z-index: 0;
            pointer-events: none;
          }

          .tool.dark .bg-graphic {
            color: rgba(255,255,255,.10);
            opacity: 1;
          }

          .tool.studio .bg-graphic {
            color: rgba(255,229,0,.13);
            opacity: 1;
          }

          .toolsRow {
            position: relative;
            z-index: 1;
            display: flex;
            gap: 12px;
            overflow-x: auto;
            padding: 3px 0 8px;
            scrollbar-width: thin;
            align-items: flex-start;
          }

          .toolTile {
            position: relative;
            flex: 0 0 142px;
            width: 142px;
            height: 156px;
            min-height: 0;
            border: 1px solid rgba(6,36,91,.12);
            border-radius: 20px;
            padding: 13px;
            text-align: left;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            color: ${NAVY};
            transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
            overflow: hidden;
            font-family: inherit;
          }

          .toolTile::after {
            content: "";
            position: absolute;
            right: -22px;
            bottom: -22px;
            width: 82px;
            height: 82px;
            border-radius: 28px;
            background: var(--shape, rgba(6,36,91,.06));
            transform: rotate(12deg);
            opacity: .85;
            pointer-events: none;
          }

          .toolTile::before {
            content: "";
            position: absolute;
            right: 12px;
            bottom: 12px;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: var(--dot, rgba(255,255,255,.58));
            opacity: .78;
            pointer-events: none;
          }

          .toolTile:hover,
          .toolTile.active {
            transform: translateY(-3px);
            box-shadow: 0 18px 42px rgba(6,36,91,.16), 0 0 0 4px rgba(6,36,91,.04);
          }

          .toolTile:hover {
            border-color: rgba(6,36,91,.28);
          }

          .toolTile.active {
            border-color: ${NAVY};
            box-shadow: 0 18px 42px rgba(6,36,91,.16), 0 0 0 4px rgba(6,36,91,.05);
          }

          .toolTile.white {
            background:
              linear-gradient(145deg, rgba(255,255,255,.96), rgba(248,251,255,.92)),
              var(--tile-bg, #fff);
          }

          .toolTile.soft {
            background:
              linear-gradient(145deg, rgba(255,255,255,.78), rgba(239,246,255,.9)),
              var(--tile-bg, #f8fbff);
          }

          .toolTile.yellow {
            background: linear-gradient(145deg, ${YELLOW}, #ffd900);
          }

          .toolTile.dark {
            background: ${NAVY};
            color: #fff;
            border-color: transparent;
          }

          .toolTile.large {
            flex-basis: 184px;
            width: 184px;
          }

          .toolTile.wide {
            flex-basis: 176px;
            width: 176px;
          }

          .toolTile.studio {
            flex-basis: 276px;
            width: 276px;
            background: linear-gradient(135deg, ${NAVY} 0%, #0b347d 58%, #102f66 100%);
            color: #fff;
            border-color: transparent;
            box-shadow: 0 18px 42px rgba(6,36,91,.18);
          }

          .bgGraphic {
            position: absolute;
            right: -18px;
            bottom: -19px;
            width: 82px;
            height: 82px;
            color: var(--shape, rgba(6,36,91,.07));
            opacity: .75;
            z-index: 0;
            pointer-events: none;
          }

          .dark .bgGraphic {
            color: rgba(255,255,255,.10);
            opacity: 1;
          }

          .studio .bgGraphic {
            color: rgba(255,229,0,.13);
            opacity: 1;
          }

          .toolTop,
          .toolTile h3,
          .toolTile p,
          .toolArt,
          .toolFoot {
            position: relative;
            z-index: 1;
          }

          .toolTop {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
          }

          .toolIcon {
            width: 32px;
            height: 32px;
            border-radius: 11px;
            display: grid;
            place-items: center;
            background: rgba(255,255,255,.78);
            color: ${NAVY};
            border: 1px solid rgba(6,36,91,.08);
            box-shadow: 0 9px 22px rgba(15,23,42,.08);
            font-weight: 950;
          }

          .toolIcon svg {
            width: 17px;
            height: 17px;
          }

          .dark .toolIcon,
          .studio .toolIcon {
            background: rgba(255,255,255,.13);
            border-color: rgba(255,255,255,.14);
            color: #fff;
          }

          .proPill {
            position: relative;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 8px 5px 20px;
            border-radius: 999px;
            background: ${NAVY};
            color: #fff;
            font-size: 9px;
            font-weight: 900;
            text-transform: uppercase;
          }

          .proPill::before {
            content: "";
            position: absolute;
            left: 8px;
            top: 10px;
            width: 8px;
            height: 7px;
            border: 1.8px solid currentColor;
            border-radius: 2px;
            box-sizing: border-box;
          }

          .proPill::after {
            content: "";
            position: absolute;
            left: 8.5px;
            top: 5px;
            width: 7px;
            height: 6px;
            border: 1.8px solid currentColor;
            border-bottom: 0;
            border-radius: 6px 6px 0 0;
            box-sizing: border-box;
          }

          .dark .proPill,
          .studio .proPill {
            background: ${YELLOW};
            color: ${NAVY};
          }

          .toolTile h3 {
            margin: 9px 0 4px;
            color: inherit;
            font-size: 14px;
            line-height: 1.15;
            font-weight: 900;
            letter-spacing: 0;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }

          .toolTile p {
            margin: 0;
            color: #64748b;
            font-size: 10px;
            line-height: 1.3;
            font-weight: 700;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }

          .toolTile.yellow p {
            color: ${NAVY};
          }

          .dark.toolTile p,
          .studio.toolTile p {
            color: #fff;
            opacity: .78;
          }

          .toolArt {
            height: 42px;
            min-height: 0;
            display: flex;
            align-items: flex-end;
            gap: 7px;
            margin-top: auto;
            padding-top: 7px;
            overflow: hidden;
          }

          .tileViz {
            position: relative;
            display: flex;
            align-items: flex-end;
            gap: 7px;
            width: 100%;
            height: 42px;
          }

          .tileViz em {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 24px;
            padding: 5px 8px;
            border-radius: 999px;
            background: rgba(255,255,255,.72);
            border: 1px solid rgba(6,36,91,.08);
            color: ${NAVY};
            font-size: 9px;
            line-height: 1;
            font-style: normal;
            font-weight: 950;
            box-shadow: 0 8px 18px rgba(15,23,42,.06);
          }

          .dark .tileViz em,
          .studio .tileViz em {
            background: rgba(255,255,255,.12);
            border-color: rgba(255,255,255,.16);
            color: #fff;
          }

          .feedbackCard,
          .rewriteCard,
          .promptCard {
            position: relative;
            display: grid;
            gap: 4px;
            width: 58px;
            min-height: 36px;
            padding: 8px;
            border-radius: 13px;
            background: rgba(255,255,255,.82);
            border: 1px solid rgba(6,36,91,.08);
            box-shadow: 0 10px 22px rgba(15,23,42,.08);
          }

          .feedbackCard span,
          .rewriteCard span,
          .promptCard span,
          .outlineLines i {
            display: block;
            height: 4px;
            border-radius: 999px;
            background: rgba(6,36,91,.22);
          }

          .feedbackCard span:first-child,
          .rewriteCard span:first-child,
          .promptCard span:first-child,
          .outlineLines i:first-child {
            width: 72%;
            background: ${NAVY};
          }

          .feedbackCard span:nth-child(2),
          .rewriteCard span:nth-child(2),
          .promptCard span:nth-child(2),
          .outlineLines i:nth-child(2) {
            width: 100%;
          }

          .feedbackCard b,
          .rewriteCard b,
          .promptCard b {
            position: absolute;
            right: 7px;
            bottom: 6px;
            width: 12px;
            height: 12px;
            border-radius: 999px;
            background: ${YELLOW};
            box-shadow: 0 0 0 4px rgba(255,229,0,.22);
          }

          .rewriteCard b {
            border-radius: 5px;
            background: ${NAVY};
          }

          .promptCard b {
            width: 14px;
            height: 14px;
            border-radius: 6px;
            background:
              linear-gradient(135deg, transparent 0 38%, #fff 39% 52%, transparent 53%),
              ${NAVY};
          }

          .miniBars,
          .barChart {
            display: flex;
            align-items: flex-end;
            gap: 4px;
            height: 28px;
          }

          .miniBars i,
          .bar {
            width: 9px;
            border-radius: 999px 999px 4px 4px;
            background: ${NAVY};
            opacity: .9;
          }

          .miniBars i {
            width: 7px;
            background: linear-gradient(180deg, ${NAVY}, #2f6bd9);
          }

          .dark .bar,
          .studio .bar,
          .dark .miniBars i,
          .studio .miniBars i {
            background: ${YELLOW};
          }

          .bubble {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 0;
            max-width: 116px;
            padding: 5px 7px;
            border-radius: 12px;
            background: rgba(255,255,255,.8);
            border: 1px solid rgba(6,36,91,.08);
            color: ${NAVY};
            font-size: 9px;
            line-height: 1.25;
            font-weight: 900;
            box-shadow: 0 8px 18px rgba(15,23,42,.05);
          }

          .dark .bubble,
          .studio .bubble {
            background: rgba(255,255,255,.12);
            border-color: rgba(255,255,255,.16);
            color: #fff;
          }

          .yellow .bubble {
            background: rgba(255,255,255,.6);
          }

          .sliderArt {
            display: grid;
            gap: 7px;
            width: 100%;
            max-width: 138px;
            align-self: center;
          }

          .slider {
            position: relative;
            height: 7px;
            border-radius: 999px;
            background: rgba(255,255,255,.16);
          }

          .slider span {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: ${YELLOW};
            box-shadow: 0 0 18px rgba(255,229,0,.35);
          }

          .slider::after {
            content: "";
            position: absolute;
            top: 50%;
            left: var(--knob, 70%);
            width: 13px;
            height: 13px;
            border-radius: 999px;
            background: #fff;
            transform: translate(-50%, -50%);
            box-shadow: 0 4px 10px rgba(0,0,0,.18);
          }

          .nodeChart {
            display: flex;
            align-items: center;
            gap: 6px;
            padding-left: 2px;
            margin-bottom: 9px;
          }

          .nodeChart span {
            position: relative;
            width: 9px;
            height: 9px;
            border-radius: 999px;
            background: ${YELLOW};
            box-shadow: 0 0 0 5px rgba(255,229,0,.18);
          }

          .nodeChart span::after {
            content: "";
            position: absolute;
            left: 9px;
            top: 50%;
            width: 13px;
            height: 2px;
            border-radius: 999px;
            background: rgba(255,229,0,.55);
            transform: translateY(-50%);
          }

          .nodeChart span:last-child::after {
            display: none;
          }

          .outlineLines {
            display: grid;
            gap: 4px;
            width: 58px;
            padding: 8px;
            border-radius: 12px;
            background: rgba(255,255,255,.10);
            border: 1px solid rgba(255,255,255,.14);
          }

          .outlineLines i {
            background: rgba(255,255,255,.34);
          }

          .outlineLines i:first-child {
            background: ${YELLOW};
          }

          .scoreRing {
            position: relative;
            width: 31px;
            height: 31px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            background: conic-gradient(${YELLOW} 0 330deg, rgba(255,255,255,.15) 0);
            box-shadow: 0 8px 18px rgba(0,0,0,.16);
          }

          .scoreRing::before {
            content: "";
            position: absolute;
            inset: 5px;
            width: auto;
            height: auto;
            border-radius: inherit;
            background: ${NAVY};
          }

          .scoreRing span {
            position: relative;
            z-index: 1;
            color: ${YELLOW};
            font-size: 11px;
            font-weight: 950;
          }

          .targetMark {
            position: relative;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background:
              radial-gradient(circle, ${NAVY} 0 5px, transparent 6px),
              radial-gradient(circle, transparent 0 13px, rgba(6,36,91,.20) 14px 16px, transparent 17px),
              radial-gradient(circle, transparent 0 24px, rgba(6,36,91,.15) 25px 27px, transparent 28px);
          }

          .targetMark span {
            position: absolute;
            inset: 8px;
            border-radius: inherit;
            border: 2px solid rgba(6,36,91,.18);
          }

          .targetMark b {
            position: absolute;
            top: 7px;
            right: 4px;
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: #ef4444;
            box-shadow: 0 0 0 3px rgba(239,68,68,.16);
          }

          .checkStack {
            display: grid;
            gap: 6px;
            width: 66px;
            padding: 9px;
            border-radius: 13px;
            background: rgba(255,255,255,.84);
            border: 1px solid rgba(6,36,91,.08);
            box-shadow: 0 10px 22px rgba(15,23,42,.07);
          }

          .checkStack span {
            position: relative;
            height: 5px;
            border-radius: 999px;
            background: rgba(6,36,91,.16);
          }

          .checkStack span i {
            position: absolute;
            inset: 0 auto 0 0;
            width: 66%;
            border-radius: inherit;
            background: ${NAVY};
          }

          .checkStack span:nth-child(2) i {
            width: 82%;
            background: ${YELLOW};
          }

          .flagMark {
            position: relative;
            width: 44px;
            height: 36px;
            flex: 0 0 auto;
          }

          .flagMark span {
            position: absolute;
            left: 8px;
            top: 3px;
            width: 3px;
            height: 31px;
            border-radius: 999px;
            background: ${NAVY};
          }

          .flagMark b {
            position: absolute;
            left: 12px;
            top: 5px;
            width: 28px;
            height: 19px;
            border-radius: 5px 12px 12px 5px;
            background: rgba(6,36,91,.12);
            border: 2px solid ${NAVY};
          }

          .studioSpark {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-left: 2px;
            padding-bottom: 1px;
          }

          .studioSpark i {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: rgba(255,255,255,.42);
          }

          .studioSpark i:nth-child(2) {
            background: ${YELLOW};
            box-shadow: 0 0 12px rgba(255,229,0,.6);
          }

          .toolFoot {
            color: #8491a3;
            font-size: 10px;
            font-weight: 900;
            margin-top: 6px;
            line-height: 1.1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .dark .toolFoot,
          .studio .toolFoot {
            color: #fff;
            opacity: .78;
          }

          .yellow .toolFoot {
            color: ${NAVY};
          }

          /* Keep the rebuilt mockup tile strip isolated from the legacy tile helpers above. */
          .tool .bubble {
            display: block;
            min-height: auto;
            max-width: none;
            border-radius: 12px;
            background: rgba(255,255,255,.78);
            border: 1px solid rgba(6,36,91,.08);
            padding: 5px 7px;
            color: ${NAVY};
            font-size: 9px;
            line-height: 1.25;
            font-weight: 900;
            box-shadow: 0 8px 20px rgba(15,23,42,.07);
          }

          .tool.dark .bubble,
          .tool.studio .bubble {
            background: rgba(255,255,255,.12);
            color: #fff;
            border-color: rgba(255,255,255,.16);
          }

          .tool .bar {
            width: 9px;
            border-radius: 999px 999px 4px 4px;
            background: ${NAVY};
            opacity: .9;
          }

          .tool.dark .bar,
          .tool.studio .bar {
            background: ${YELLOW};
          }

          .tool .slider {
            position: relative;
            height: 7px;
            border-radius: 999px;
            background: rgba(255,255,255,.16);
            overflow: visible;
          }

          .tool .slider span {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: ${YELLOW};
            box-shadow: 0 0 18px rgba(255,229,0,.35);
          }

          .tool .slider::after {
            content: "";
            position: absolute;
            top: 50%;
            left: var(--knob, 70%);
            width: 13px;
            height: 13px;
            border-radius: 999px;
            background: #fff;
            transform: translate(-50%, -50%);
            box-shadow: 0 4px 10px rgba(0,0,0,.18);
          }

          .launchArea {
            padding: 20px;
          }

          .launchArea {
            display: grid;
            grid-template-columns: minmax(220px, 30%) minmax(0, 70%);
            gap: 14px;
            min-height: 520px;
          }

          .infoPane,
          .workAcc {
            border: 1px solid #d8e4f5;
            border-radius: 22px;
            background: #fff;
            box-shadow: 0 12px 34px rgba(15,23,42,.052);
            overflow: hidden;
          }

          .infoPane {
            padding: 18px;
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 14px;
          }

          .infoPane::after {
            content: "";
            position: absolute;
            right: -62px;
            bottom: -72px;
            width: 190px;
            height: 190px;
            border-radius: 44px;
            background: linear-gradient(135deg, rgba(255,229,0,.22), rgba(237,244,255,.9));
            transform: rotate(13deg);
            z-index: 0;
          }

          .infoPane > * { position: relative; z-index: 1; }

          .staticTitle {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .staticIcon {
            width: 54px;
            height: 54px;
            border-radius: 17px;
            display: grid;
            place-items: center;
            background: linear-gradient(135deg, #eef4ff, #fffde8);
            color: ${NAVY};
            font-size: 19px;
            font-weight: 950;
            box-shadow: inset 0 0 0 1px #dfe8f6;
            flex: 0 0 auto;
          }

          .staticTitle h2,
          .workTitle strong {
            display: block;
            margin: 0;
            color: ${NAVY};
            font-size: 20px;
            line-height: 1.2;
            font-weight: 900;
            letter-spacing: 0;
          }

          .staticTitle p,
          .workTitle small {
            display: block;
            margin: 5px 0 0;
            color: #64748b;
            font: 400 15px/1.75 'DM Sans', system-ui, sans-serif;
          }

          .readerSwitch {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px;
            border: 1px solid #dfe7f3;
            border-radius: 999px;
            background: #f8fafc;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.8);
            width: fit-content;
          }

          .readerSwitch button {
            border: 0;
            min-height: 36px;
            padding: 0 15px;
            border-radius: 999px;
            color: #64748b;
            background: transparent;
            font-size: 12px;
            font-weight: 950;
            white-space: nowrap;
            cursor: pointer;
            font-family: inherit;
          }

          .readerSwitch button.active {
            background: ${NAVY};
            color: #fff;
            box-shadow: 0 8px 18px rgba(6,36,91,.18);
          }

          .readerSwitch .proMode b {
            margin-left: 6px;
            padding: 4px 7px;
            border-radius: 999px;
            background: ${YELLOW};
            color: ${NAVY};
            font-size: 9px;
          }

          .staticCopy {
            margin: 0;
            color: #64748b;
            font: 400 15px/1.75 'DM Sans', system-ui, sans-serif;
          }

          .miniStack {
            display: grid;
            gap: 8px;
          }

          .miniRow {
            border: 1px solid #e6edf7;
            border-radius: 13px;
            background: #fbfcfe;
            padding: 10px;
            color: #64748b;
            font: 400 15px/1.75 'DM Sans', system-ui, sans-serif;
          }

          .miniRow b {
            display: block;
            color: ${NAVY};
            font-size: 12px;
            line-height: 1.2;
            margin-bottom: 5px;
          }

          .upgradeCard {
            margin-top: auto;
            border: 0;
            border-radius: 16px;
            background: ${NAVY};
            color: #fff;
            padding: 15px;
            text-align: left;
            cursor: pointer;
            font-family: inherit;
            box-shadow: 0 14px 30px rgba(6,36,91,.18);
          }

          .upgradeCard span {
            width: 32px;
            height: 32px;
            display: grid;
            place-items: center;
            border-radius: 999px;
            background: ${YELLOW};
            color: ${NAVY};
            margin-bottom: 10px;
          }

          .upgradeCard strong,
          .upgradeCard small {
            display: block;
          }

          .upgradeCard strong {
            font-size: 15px;
            color: ${YELLOW};
          }

          .upgradeCard small {
            color: rgba(255,255,255,.72);
            margin-top: 4px;
            line-height: 1.45;
            font-size: 12px;
          }

          .rightAccordion {
            display: grid;
            gap: 12px;
            min-width: 0;
          }

          .rightAccordion.inputOpen { grid-template-rows: minmax(0, 1fr) auto; }
          .rightAccordion.outputOpen { grid-template-rows: auto minmax(0, 1fr); }

          .workAcc {
            display: flex;
            flex-direction: column;
            min-height: 0;
          }

          .workHead {
            display: grid;
            grid-template-columns: 42px minmax(0, 1fr) auto;
            align-items: center;
            gap: 12px;
            padding: 14px 16px;
            border: 0;
            border-bottom: 1px solid #e2e8f0;
            min-height: 82px;
            background: #fff;
            text-align: left;
            cursor: pointer;
            font-family: inherit;
          }

          .workNum {
            width: 34px;
            height: 34px;
            border-radius: 12px;
            display: grid;
            place-items: center;
            background: ${NAVY};
            color: #fff;
            font-size: 12px;
            font-weight: 950;
          }

          .workState {
            color: #64748b;
            font-size: 11px;
            font-weight: 900;
            white-space: nowrap;
          }

          .workBody {
            padding: 16px;
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .inputOpen .outputPanel {
            min-height: 104px;
            flex: 0 0 auto;
          }

          .inputOpen .outputPanel .workHead {
            border-bottom: 0;
          }

          .inputOpen .outputPanel .workBody {
            display: none;
          }

          .inputOpen .outputPanel .workNum,
          .outputOpen .inputPanel .workNum {
            background: #eef4ff;
            color: ${NAVY};
          }

          .outputOpen .inputPanel {
            min-height: 104px;
          }

          .outputOpen .inputPanel .workHead {
            border-bottom: 0;
          }

          .outputOpen .inputPanel .workBody {
            display: none;
          }

          .outputOpen .outputPanel .workHead {
            display: none;
          }

          .promptStrip {
            border: 1px solid #e1e8f2;
            border-radius: 14px;
            background: #f8fafc;
            padding: 12px 13px;
            color: #526174;
            display: grid;
            gap: 3px;
          }

          .promptStrip b {
            color: ${NAVY};
            font-size: 12px;
          }

          .promptStrip textarea {
            width: 100%;
            min-height: 39px;
            max-height: 62px;
            resize: none;
            overflow-y: auto;
            border: 0;
            outline: 0;
            background: transparent;
            color: #223046;
            font: 400 15px/1.75 'DM Sans', system-ui, sans-serif;
          }

          .promptStrip small {
            color: #64748b;
            font-size: 10px;
            font-weight: 800;
            text-align: right;
          }

          .essayInput {
            width: 100%;
            min-height: 260px;
            flex: 1;
            resize: none;
            overflow-y: auto;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            outline: 0;
            padding: 17px;
            color: #223046;
            font: 400 15px/1.75 'DM Sans', system-ui, sans-serif;
            background: #fff;
          }

          .errorBanner {
            display: flex;
            align-items: center;
            gap: 8px;
            border-radius: 12px;
            background: #fef2f2;
            color: #991b1b;
            padding: 10px 12px;
            font-size: 12px;
            font-weight: 800;
          }

          .actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-top: auto;
          }

          .actions p {
            margin: 0;
            color: #64748b;
            font-size: 11px;
            line-height: 1.4;
            font-weight: 800;
          }

          .loadingDots {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            color: ${NAVY};
            font-size: 11px;
            font-weight: 900;
          }

          .loadingDots::before {
            content: "";
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: ${YELLOW};
            box-shadow: 16px 0 0 rgba(255,229,0,.55), 32px 0 0 rgba(255,229,0,.25);
          }

          .runButton {
            border: 0;
            border-radius: 14px;
            padding: 13px 18px;
            background: ${NAVY};
            color: #fff;
            font-size: 13px;
            font-weight: 900;
            cursor: pointer;
            font-family: inherit;
            white-space: nowrap;
          }

          .runButton:disabled {
            opacity: .45;
            cursor: not-allowed;
          }

          .outputBody {
            display: flex;
          }

          .readiness {
            margin: -16px -16px 2px;
            border-radius: 22px 22px 0 0;
            background: ${NAVY};
            color: #fff;
            padding: 24px 26px;
            min-height: 124px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }

          .readiness span {
            color: rgba(255,255,255,.76);
            font-size: 12px;
            font-weight: 800;
          }

          .readiness h3 {
            margin: 0;
            color: #fff;
            font-size: 20px;
            line-height: 1.2;
            letter-spacing: 0;
          }

          .readiness p {
            margin: 5px 0 0;
            color: rgba(255,255,255,.72);
            font: 400 15px/1.75 'DM Sans', system-ui, sans-serif;
          }

          .readiness b {
            color: ${YELLOW};
            font-size: 46px;
            line-height: 1;
            white-space: nowrap;
          }

          .outputGrid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            min-width: 0;
          }

          .outputChip {
            border: 1px solid #e6edf7;
            border-radius: 14px;
            background: #fff;
            padding: 13px;
            min-height: 112px;
            min-width: 0;
          }

          .outputChip.wide {
            grid-column: 1 / -1;
            min-height: 96px;
          }

          .outputChip h3 {
            margin: 0 0 5px;
            color: ${NAVY};
            font-size: 12px;
            letter-spacing: 0;
            font-weight: 900;
          }

          .outputChip p {
            margin: 0;
            color: #64748b;
            font: 400 15px/1.75 'DM Sans', system-ui, sans-serif;
          }

          @media (max-width: 1100px) {
            .launchArea {
              grid-template-columns: 1fr;
            }
          }

          @media (max-width: 760px) {
            .essayLabPage {
              padding: 20px;
            }

            .labHeader h1 {
              font-size: 30px;
            }

            .levelTitle,
            .actions {
              align-items: flex-start;
              flex-direction: column;
            }

            .outputGrid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </main>
    </AppShell>
  );
}
