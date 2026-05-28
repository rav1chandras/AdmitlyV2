'use client';

import { useMemo, useState, type CSSProperties, type ClipboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AppShell } from '@/components/AppShell';

type ReaderRole = 'teacher' | 'admissions_officer';
type SelectivityTier = 'highly' | 'selective' | 'moderate';
type ToolId = 'reader' | 'studio' | 'thesis' | 'outline' | 'paragraph' | 'evidence' | 'conclusion' | 'score' | 'prompt-fit';

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
  id: ToolId;
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

interface ToolResult {
  toolId: ToolId;
  score?: number;
  headline: string;
  summary: string;
  chips: Array<{ title: string; body: string }>;
}

const NAVY = '#06245B';
const YELLOW = '#FFE500';
const FREE_DAILY_LIMIT = 3;
const RUNNABLE_TOOL_IDS: ToolId[] = ['reader', 'thesis', 'outline', 'paragraph', 'evidence', 'conclusion', 'score', 'prompt-fit'];

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

const TOOL_CONTENT: Record<ToolId, {
  short: string;
  staticIcon: string;
  title: string;
  intro: string;
  miniRows: Array<[string, string]>;
  inputTitle: string;
  inputHint: string;
  placeholder: string;
  runLabel: string;
  runningLabel: string;
  outputTitle: string;
  outputHint: string;
  minWords: number;
}> = {
  reader: {
    short: 'TR',
    staticIcon: 'TR',
    title: 'Reader Simulator',
    intro: 'Teacher Review previews how a school essay may land with a classroom reader. It focuses on first impression, rubric risks, and the fixes that make the draft feel ready.',
    miniRows: [['Reader', 'High school teacher review for class essays.'], ['Strictness', 'Balanced feedback with practical comments.'], ['Output', 'First impression, concerns, and top fixes.']],
    inputTitle: 'Essay Input',
    inputHint: 'Paste the prompt and essay, then run the reader.',
    placeholder: 'Paste or write your essay here. Reader Simulator will preview how it may land with a high school teacher.',
    runLabel: 'Run Reader Simulator',
    runningLabel: 'Reading draft',
    outputTitle: 'Teacher readiness',
    outputHint: 'View teacher-style feedback.',
    minWords: 50,
  },
  studio: {
    short: 'ES',
    staticIcon: 'ES',
    title: 'Essay Studio',
    intro: 'Full drafting workspace with voice, journey, and review controls.',
    miniRows: [['Workspace', 'Draft, revise, review, and save essays.'], ['Voice', 'Use personal writing samples when enabled.'], ['Output', 'Structured essay drafting workflow.']],
    inputTitle: 'Essay Studio',
    inputHint: 'Open the full drafting workspace.',
    placeholder: 'Essay Studio opens in the full essay workspace.',
    runLabel: 'Open Essay Studio',
    runningLabel: 'Opening',
    outputTitle: 'Essay Studio',
    outputHint: 'Full workspace.',
    minWords: 0,
  },
  thesis: {
    short: 'TC',
    staticIcon: 'TC',
    title: 'Thesis Checker',
    intro: 'Thesis Checker finds whether the draft has a clear, specific, arguable central idea and suggests a stronger version.',
    miniRows: [['Checks', 'Clarity, specificity, and arguable claim.'], ['Best for', 'Introductions and argument essays.'], ['Output', 'Score, gaps, rewrite, and next step.']],
    inputTitle: 'Thesis Input',
    inputHint: 'Paste the prompt and the paragraph with your thesis.',
    placeholder: 'Paste your intro paragraph or the section that contains your thesis.',
    runLabel: 'Check Thesis',
    runningLabel: 'Checking thesis',
    outputTitle: 'Thesis result',
    outputHint: 'View thesis clarity and rewrite ideas.',
    minWords: 20,
  },
  outline: {
    short: 'OB',
    staticIcon: 'OB',
    title: 'Outline Builder',
    intro: 'Outline Builder turns a prompt, thesis, or rough idea into a paragraph-by-paragraph essay plan.',
    miniRows: [['Builds', 'Hook, body points, counterpoint, conclusion.'], ['Best for', 'Starting a draft from a prompt.'], ['Output', 'Clean outline with evidence notes.']],
    inputTitle: 'Outline Input',
    inputHint: 'Paste the prompt, thesis, or rough idea.',
    placeholder: 'Paste your assignment prompt and any early thesis or ideas. Outline Builder will organize it into a draft plan.',
    runLabel: 'Build Outline',
    runningLabel: 'Building outline',
    outputTitle: 'Generated outline',
    outputHint: 'View the paragraph plan.',
    minWords: 10,
  },
  paragraph: {
    short: 'PF',
    staticIcon: 'PF',
    title: 'Paragraph Fixer',
    intro: 'Paragraph Fixer polishes one paragraph for clarity, grammar, and flow while preserving the student’s meaning.',
    miniRows: [['Fixes', 'Clarity, sentence flow, and repetition.'], ['Best for', 'One rough paragraph at a time.'], ['Output', 'Before/after rewrite plus edit notes.']],
    inputTitle: 'Paragraph Input',
    inputHint: 'Paste one paragraph you want cleaned up.',
    placeholder: 'Paste one paragraph that feels rough, repetitive, or unclear.',
    runLabel: 'Fix Paragraph',
    runningLabel: 'Polishing paragraph',
    outputTitle: 'Paragraph fix',
    outputHint: 'View before/after polish.',
    minWords: 20,
  },
  evidence: {
    short: 'EC',
    staticIcon: 'EC',
    title: 'Evidence Checker',
    intro: 'Evidence Checker spots unsupported claims and suggests concrete proof students can add.',
    miniRows: [['Checks', 'Claim strength and proof gaps.'], ['Best for', 'Argument and analysis essays.'], ['Output', 'Claim map, strength bars, evidence ideas.']],
    inputTitle: 'Evidence Input',
    inputHint: 'Paste a body paragraph or argument section.',
    placeholder: 'Paste a paragraph with claims and examples. Evidence Checker will flag where support is thin.',
    runLabel: 'Check Evidence',
    runningLabel: 'Checking evidence',
    outputTitle: 'Evidence map',
    outputHint: 'View claim support and gaps.',
    minWords: 30,
  },
  conclusion: {
    short: 'CC',
    staticIcon: 'CC',
    title: 'Conclusion Checker',
    intro: 'Conclusion Checker tests whether the ending feels complete, reflective, and memorable.',
    miniRows: [['Checks', 'Closure, reflection, and final impression.'], ['Best for', 'Last paragraphs and final lines.'], ['Output', 'Ending score, stronger version, next step.']],
    inputTitle: 'Conclusion Input',
    inputHint: 'Paste the final paragraph or last few lines.',
    placeholder: 'Paste your conclusion. The checker will show whether the ending lands cleanly.',
    runLabel: 'Check Ending',
    runningLabel: 'Checking ending',
    outputTitle: 'Ending preview',
    outputHint: 'View conclusion strength.',
    minWords: 20,
  },
  score: {
    short: 'FS',
    staticIcon: 'FS',
    title: 'Full Essay Score',
    intro: 'Full Essay Score gives a premium-style readiness report across structure, voice, evidence, specificity, and reflection.',
    miniRows: [['Rubric', 'Structure, evidence, clarity, voice.'], ['Best for', 'Full draft review.'], ['Output', 'Detailed score report.']],
    inputTitle: 'Full Essay Score',
    inputHint: 'Paste the full essay for a rubric-style readiness report.',
    placeholder: 'Paste the full essay draft. Full Essay Score will review structure, evidence, voice, specificity, and readiness.',
    runLabel: 'Run Full Score',
    runningLabel: 'Scoring essay',
    outputTitle: 'Full Essay Score',
    outputHint: 'View the premium score dashboard.',
    minWords: 50,
  },
  'prompt-fit': {
    short: 'PF',
    staticIcon: 'PF',
    title: 'Prompt Fit',
    intro: 'Prompt Fit checks whether the draft fully answers the assignment or application prompt.',
    miniRows: [['Checks', 'Prompt coverage and missing asks.'], ['Best for', 'Final review before submitting.'], ['Output', 'Prompt gaps and alignment notes.']],
    inputTitle: 'Prompt Fit',
    inputHint: 'Paste the prompt above and the essay below.',
    placeholder: 'Paste the essay draft. Prompt Fit will compare it against the optional prompt above and flag missing asks.',
    runLabel: 'Check Prompt Fit',
    runningLabel: 'Checking prompt fit',
    outputTitle: 'Prompt Fit',
    outputHint: 'View prompt coverage and missing asks.',
    minWords: 50,
  },
};

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

function buildToolResult(toolId: ToolId, essay: string, prompt: string): ToolResult {
  const firstSentence = essay.trim().split(/(?<=[.!?])\s+/)[0] || 'Your draft has a workable starting point.';
  const thesisRewrite = prompt.trim()
    ? `${prompt.trim().replace(/[.!?]+$/, '')}: the strongest version should name a clear position, a specific reason, and the outcome that matters.`
    : 'A stronger thesis should name the main claim, the specific reason, and why that reason matters.';

  if (toolId === 'thesis') {
    return {
      toolId,
      score: 72,
      headline: 'Clear idea, but the claim needs sharper stakes.',
      summary: 'The thesis is understandable, but it reads more like a topic sentence than a debatable position.',
      chips: [
        { title: 'What works', body: 'The reader can tell the broad topic and direction quickly.' },
        { title: 'What is missing', body: 'Add a more specific reason and make the position easier to argue.' },
        { title: 'Try this', body: thesisRewrite },
        { title: 'Next step', body: 'Build body paragraphs around one reason, one example, and one consequence.' },
      ],
    };
  }

  if (toolId === 'outline') {
    return {
      toolId,
      headline: 'A five-part outline is ready to draft.',
      summary: 'The plan gives the student a hook, two main points, a counterpoint, and a conclusion path.',
      chips: [
        { title: 'Hook + context', body: 'Open with a concrete moment related to the prompt, then introduce the central question.' },
        { title: 'Body point one', body: 'Use the strongest reason from the thesis and support it with a specific example.' },
        { title: 'Body point two', body: 'Add a second reason that shows growth, consequence, or contrast.' },
        { title: 'Conclusion', body: 'Return to the opening moment and explain what the reader should remember.' },
      ],
    };
  }

  if (toolId === 'paragraph') {
    return {
      toolId,
      headline: 'The paragraph can be clearer without losing voice.',
      summary: 'The original idea works. The fix adds a concrete scene, trims repetition, and makes the reflection land.',
      chips: [
        { title: 'Original focus', body: firstSentence },
        { title: 'Polished version', body: 'I started the activity unsure of where I fit, but one specific mistake showed me what I needed to practice. Each attempt after that made the work feel less intimidating and more like something I could improve through effort.' },
        { title: 'What changed', body: 'The rewrite adds a clearer moment, removes broad phrasing, and connects action to growth.' },
        { title: 'Keep your voice', body: 'Use words you would actually say. The goal is cleaner, not fancier.' },
      ],
    };
  }

  if (toolId === 'evidence') {
    return {
      toolId,
      score: 64,
      headline: 'Several claims need more concrete proof.',
      summary: 'The paragraph has claims, but some still need examples, details, or a quick contrast to feel believable.',
      chips: [
        { title: 'Strongest claim', body: 'Keep the claim that has a specific action or outcome attached to it.' },
        { title: 'Proof gap', body: 'Add one moment where the reader can see what happened, not just what you learned.' },
        { title: 'Evidence idea', body: 'Use a number, a brief scene, a quote, or a before/after contrast.' },
        { title: 'Next revision', body: 'After every claim, ask: “How would a skeptical reader know this is true?”' },
      ],
    };
  }

  if (toolId === 'score') {
    return {
      toolId,
      score: 86,
      headline: 'Strong draft with one evidence gap.',
      summary: 'The essay has a believable growth arc. Stronger concrete proof would make it feel more admissions-ready.',
      chips: [
        { title: 'Specificity', body: 'Good moments are present, but two claims need sharper scenes.' },
        { title: 'Structure', body: 'Clear beginning, turn, and ending. The order is easy to follow.' },
        { title: 'Voice', body: 'The tone feels personal and not over-polished.' },
        { title: 'Top fix', body: 'Add one later example where your improved leadership changed the team outcome.' },
      ],
    };
  }

  if (toolId === 'prompt-fit') {
    return {
      toolId,
      score: 76,
      headline: 'Most of the prompt is covered, but one ask is missing.',
      summary: 'The draft addresses the challenge and response, but needs a clearer future connection.',
      chips: [
        { title: 'Covered', body: 'The essay describes a challenge and explains the immediate response.' },
        { title: 'Partial', body: 'The reflection is present, but it should show one new behavior that proves the change.' },
        { title: 'Missing ask', body: 'Add one sentence that shows how this growth affects what you will contribute next.' },
        { title: 'Suggested bridge', body: 'Now, before I lead with my own idea, I ask what the team has already noticed.' },
      ],
    };
  }

  return {
    toolId,
    score: 74,
    headline: 'The ending is clear, but it can be more memorable.',
    summary: 'The conclusion closes the topic, but it should return to a concrete image or insight instead of a broad final sentence.',
    chips: [
      { title: 'What works', body: 'The ending does not introduce a new argument, which keeps it focused.' },
      { title: 'What feels flat', body: 'The final line is broad. It could belong to many essays.' },
      { title: 'Stronger ending', body: 'End by returning to the most specific moment in the essay and showing why it matters now.' },
      { title: 'Final move', body: 'Replace “I learned a lot” with one precise change in how you think or act.' },
    ],
  };
}

export default function EssayLabPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isPro = (session?.user as any)?.subscription_status === 'pro' || (session?.user as any)?.subscription_status === 'premium';

  const [selectedTool, setSelectedTool] = useState<ToolId>('reader');
  const [readerRole, setReaderRole] = useState<ReaderRole>('teacher');
  const [prompt, setPrompt] = useState('Explain how a challenge shaped your perspective with clear evidence and reflection.');
  const [essay, setEssay] = useState('When I joined the robotics team, I thought my job was to be the person with the best ideas. At our first competition, our robot stopped moving during the second round, and I kept suggesting fixes before listening to anyone else. My teammate Maya finally asked me to stop talking and check the wiring with her. We found a loose connector in three minutes. That moment taught me that leadership is not always being the loudest person in the room. Sometimes it is slowing down enough to help the team think clearly.');
  const [result, setResult] = useState<ReaderResult | null>(null);
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);
  const [activePane, setActivePane] = useState<'input' | 'output'>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);

  const promptWords = useMemo(() => wordsFrom(prompt).length, [prompt]);
  const essayWords = useMemo(() => wordsFrom(essay).length, [essay]);
  const freeLeft = remaining ?? FREE_DAILY_LIMIT;
  const selectedContent = TOOL_CONTENT[selectedTool];
  const selectedToolMeta = TOOLS.find(tool => tool.id === selectedTool) ?? TOOLS[0];
  const isRunnable = RUNNABLE_TOOL_IDS.includes(selectedTool);
  const canRun = essayWords >= selectedContent.minWords && !loading && isRunnable;

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
    setActivePane('input');
    setResult(null);
    setToolResult(null);
    if (!RUNNABLE_TOOL_IDS.includes(tool.id)) {
      setError(`${tool.title} is a Pro tool. Use the free Essay Lab tools or open Essay Studio for full drafting.`);
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

  async function runActiveTool() {
    if (!canRun) {
      setError(essayWords < selectedContent.minWords ? `Paste at least ${selectedContent.minWords} words so ${selectedContent.title} has enough to evaluate.` : `${selectedContent.title} is not available in this mode.`);
      return;
    }

    if (selectedTool !== 'reader') {
      setLoading(true);
      setError('');
      setResult(null);
      setToolResult(null);
      window.setTimeout(() => {
        setToolResult(buildToolResult(selectedTool, essay, prompt));
        setActivePane('output');
        setLoading(false);
      }, 260);
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    setToolResult(null);

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
  const outputTitle = selectedTool === 'reader' ? (readerRole === 'teacher' ? 'Teacher readiness' : 'Admissions read') : selectedContent.outputTitle;
  const outputHint = selectedTool === 'reader'
    ? (readerRole === 'teacher' ? 'View teacher-style feedback.' : 'View admissions-style feedback.')
    : selectedContent.outputHint;
  const readerIntro = selectedTool === 'reader' && readerRole === 'admissions_officer'
    ? 'Admissions Reader previews how a college application reader may react after one pass. It focuses on memorability, differentiation, reader risk, and the revision that makes the applicant signal clearer.'
    : selectedContent.intro;
  const readerMiniRows = selectedTool === 'reader' && readerRole === 'admissions_officer'
    ? [['Reader', 'College admissions officer review for application essays.'], ['Lens', 'Memorability, differentiation, and file-reader risk.'], ['Output', 'Committee snapshot, reader risk, and best next move.']] as Array<[string, string]>
    : selectedContent.miniRows;
  const grade = result ? scoreToGrade(result.overall_score) : 'Ready';

  return (
    <AppShell>
      <main className="essayLabPage">
        <header className="labHeader">
          <div>
            <h1>Essay Lab</h1>
            <p>Pick an essay tool first. Launch only when you&apos;re ready to tune options and paste your draft.</p>
          </div>
          <div className="limitPill"><b>{isPro ? '∞' : freeLeft}</b>{isPro ? 'unlimited Pro checks' : 'free checks left today'}</div>
        </header>

        <section className="labShell">
          <section className="toolLevel">
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
                <div className="staticIcon">{selectedContent.staticIcon}</div>
                <div>
                  <h2>{selectedContent.title}</h2>
                  <p>{selectedToolMeta.desc}</p>
                </div>
              </div>

              {selectedTool === 'reader' && (
                <div className="readerSwitch" aria-label="Reader mode selector">
                  <button type="button" className={readerRole === 'teacher' ? 'active' : ''} onClick={() => chooseReaderRole('teacher')}>Teacher</button>
                  <button type="button" className={readerRole === 'admissions_officer' ? 'active proMode' : 'proMode'} onClick={() => chooseReaderRole('admissions_officer')}>
                    Admissions {!isPro && <b>PRO</b>}
                  </button>
                </div>
              )}

              <p className="staticCopy">{readerIntro}</p>

              <div className="miniStack">
                {readerMiniRows.map(([label, body]) => (
                  <div className="miniRow" key={label}><b>{label}</b> {body}</div>
                ))}
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
                    <strong>{selectedContent.inputTitle}</strong>
                    <small>{selectedContent.inputHint}</small>
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
                    placeholder={selectedContent.placeholder}
                  />

                  {error && <div className="errorBanner"><i className="fas fa-circle-exclamation" /> {error}</div>}

                  <div className="actions">
                    <p>Uses one free daily check. Results expand in the output panel.</p>
                    {loading && <span className="loadingDots">{selectedContent.runningLabel}</span>}
                    <button className="runButton" type="button" onClick={runActiveTool} disabled={!canRun}>
                      {loading ? 'Running...' : result || toolResult ? 'Run again' : selectedContent.runLabel}
                    </button>
                  </div>
                </div>
              </article>

              <article className="workAcc outputPanel">
                <button type="button" className="workHead" onClick={() => setActivePane('output')}>
                  <span className="workNum">2</span>
                  <span className="workTitle">
                    <strong>{outputTitle}</strong>
                    <small>{result || toolResult ? 'View generated feedback.' : outputHint}</small>
                  </span>
                  <span className="workState">{result || toolResult ? 'Complete' : 'Ready'}</span>
                </button>

                <div className="workBody outputBody">
                  {selectedTool === 'reader' ? (
                    readerRole === 'admissions_officer' ? (
                      <>
                        <div className="admissionsHero">
                          <div>
                            <span>2. Admissions read</span>
                            <h3>{result?.verdict_sentence ?? 'Run the admissions reader to preview committee impact'}</h3>
                            <p>{result?.first_impression ?? 'Admissions-style feedback will focus on memorability, differentiation, and reader risk.'}</p>
                          </div>
                          <div className="admitScore">
                            <small>Read strength</small>
                            <b>{result ? result.overall_score : '--'}</b>
                          </div>
                        </div>

                        <div className="admissionsGrid">
                          <article className="admissionCard wide">
                            <div className="admissionCardHead">
                              <h3>Committee Snapshot</h3>
                              <span className="admitTag">{result ? `${result.overall_score}/100` : 'Pending'}</span>
                            </div>
                            <p>{result?.first_impression ?? 'The first read will summarize what an admissions reader is likely to remember after one pass.'}</p>
                          </article>

                          <article className="admissionCard">
                            <div className="admissionCardHead">
                              <h3>Memorable Signal</h3>
                              <span className="admitDot good" />
                            </div>
                            <p>{result?.key_strengths?.join(' ') || 'The strongest applicant signal will appear here after analysis.'}</p>
                          </article>

                          <article className="admissionCard">
                            <div className="admissionCardHead">
                              <h3>Reader Risk</h3>
                              <span className="admitDot warn" />
                            </div>
                            <p>{result?.key_concerns?.join(' ') || 'The biggest risk to differentiation will appear here after analysis.'}</p>
                          </article>

                          <article className="admissionCard wide">
                            <div className="admissionCardHead">
                              <h3>What They May Remember</h3>
                              <span className="admitTag">After review</span>
                            </div>
                            <p>{result?.would_remember ?? 'A one-line memory test will appear here: what the reader may remember about this applicant after the file moves on.'}</p>
                          </article>

                          <article className="admissionCard nextMove">
                            <div className="admissionCardHead">
                              <h3>Best Next Move</h3>
                              <span className="admitTag">Revise</span>
                            </div>
                            <p>{result?.question_for_student ?? 'The next revision question will appear here after the admissions read runs.'}</p>
                          </article>
                        </div>
                      </>
                    ) : (
                      <>
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
                      </>
                    )
                  ) : (
                    <div className={`mockOutput ${selectedTool}`}>
                      {selectedTool === 'thesis' && (
                        <>
                          <article className="mockCard thesisResult">
                            <div className="mockCardHead">
                              <h3>Thesis Result</h3>
                              <span className="mockTag">Needs focus</span>
                            </div>
                            <div className="mockResultBody">
                              <div className="mockScoreRow">
                                <div className="mockScoreRing">72</div>
                                <div className="mockMeters">
                                  <div className="mockMeter">Clarity <span><i style={{ width: '82%' }} /></span></div>
                                  <div className="mockMeter">Specificity <span><i style={{ width: '54%' }} /></span></div>
                                  <div className="mockMeter">Arguable claim <span><i style={{ width: '46%' }} /></span></div>
                                </div>
                              </div>
                              <div className="mockInsightGrid">
                                <div className="mockInsight"><b>What works</b><p>The thesis is easy to understand and names the broad topic.</p></div>
                                <div className="mockInsight"><b>What is missing</b><p>It needs a sharper reason and a more debatable position.</p></div>
                                <div className="mockInsight"><b>Try this</b><p>{toolResult?.chips?.[2]?.body ?? 'Schools should use technology when it gives students faster feedback and more personalized practice.'}</p></div>
                                <div className="mockInsight"><b>Next step</b><p>Build body paragraphs around feedback speed and personalization.</p></div>
                              </div>
                            </div>
                          </article>
                        </>
                      )}

                      {selectedTool === 'outline' && (
                        <>
                          <article className="mockCard">
                            <div className="mockCardHead">
                              <h3>Generated Outline</h3>
                              <span className="mockTag">5 paragraphs</span>
                            </div>
                            <div className="outlineStack">
                              {[
                                ['Hook + context', 'Open with a classroom moment where the main idea is visible, then introduce the debate.'],
                                ['Reason one', 'Use the strongest reason from the thesis and support it with a specific example.'],
                                ['Reason two', 'Add a second reason that shows growth, consequence, or contrast.'],
                                ['Counterargument', 'Acknowledge the strongest objection, then explain why your position still holds.'],
                                ['Conclusion', 'Return to the opening moment and explain what the reader should remember.'],
                              ].map(([title, body], index) => (
                                <div className="outlineStep" key={title}>
                                  <span>{index + 1}</span>
                                  <div><h4>{title}</h4><p>{body}</p></div>
                                </div>
                              ))}
                            </div>
                          </article>
                          <aside className="mockNotes">
                            <div className="mockNote"><strong>Essay shape</strong><p>Argument essay with two reasons and one counterargument.</p></div>
                            <div className="mockNote"><strong>Evidence to add</strong><p>Use one personal example, one concrete detail, and one contrast.</p></div>
                            <div className="mockNote"><strong>Upgrade moment</strong><p>Send this outline into Essay Studio to draft in the student’s voice.</p></div>
                          </aside>
                        </>
                      )}

                      {selectedTool === 'paragraph' && (
                        <>
                          <article className="compareCard">
                            <div className="mockCardHead">
                              <h3>Before / After</h3>
                              <span className="mockTag">Voice preserved</span>
                            </div>
                            <div className="compareBody">
                              <div className="draftSide">I was nervous about joining the debate team because I did not know anyone and I was scared to talk in front of people. My first tournament was bad and I forgot some of my points. But after that I practiced more and became more confident.</div>
                              <div className="fixedSide">I joined the debate team feeling like the quietest person in the room. At my first tournament, I lost my place halfway through my argument and rushed through the rest. <span>That mistake became useful</span>: it showed me exactly what I needed to practice, and each round after that made speaking feel less impossible.</div>
                            </div>
                          </article>
                          <aside className="fixList">
                            <div className="fixItem"><span>1</span><div><b>Sharper opening</b><p>Starts with a scene instead of a broad summary.</p></div></div>
                            <div className="fixItem"><span>2</span><div><b>More specific moment</b><p>Names the exact tournament problem so the growth feels earned.</p></div></div>
                            <div className="fixItem"><span>3</span><div><b>Cleaner reflection</b><p>Connects the setback to practice and confidence without sounding generic.</p></div></div>
                          </aside>
                        </>
                      )}

                      {selectedTool === 'evidence' && (
                        <>
                          <article className="mockCard">
                            <div className="mockCardHead">
                              <h3>Claim Map</h3>
                              <span className="mockTag">3 gaps found</span>
                            </div>
                            <div className="evidenceMap">
                              {[
                                ['Claim 1', '“This experience changed me.” Needs a specific before/after moment.', '42%'],
                                ['Claim 2', '“I became a better leader.” Good claim, but add an action the reader can see.', '64%'],
                                ['Claim 3', '“The team trusted me more.” Needs a result, quote, or concrete response.', '36%'],
                                ['Claim 4', '“I learned to listen first.” Strongest point. Keep and support with one scene.', '82%'],
                              ].map(([label, body, width]) => (
                                <div className="claimRow" key={label}>
                                  <strong>{label}</strong>
                                  <p>{body}</p>
                                  <div className="strength"><i style={{ width }} /></div>
                                </div>
                              ))}
                            </div>
                          </article>
                          <aside className="sourceCard">
                            <div className="sourceChip"><b>Add a specific example</b><p>Describe one moment where the claim became visible.</p></div>
                            <div className="sourceChip"><b>Add a contrast</b><p>Show what changed from before to after.</p></div>
                            <div className="sourceChip"><b>Add a result</b><p>Name what happened because of the action.</p></div>
                          </aside>
                        </>
                      )}

                      {selectedTool === 'conclusion' && (
                        <>
                          <article className="mockCard">
                            <div className="mockCardHead">
                              <h3>Ending Preview</h3>
                              <span className="mockTag">Almost there</span>
                            </div>
                            <div className="endingPreview">
                              <div className="endingCard"><span className="mockTag">Current ending</span><h4>Feels clear, but a little flat</h4><p>This experience taught me many important lessons and helped me become a better person. I will use these lessons in the future.</p></div>
                              <div className="endingCard"><span className="mockTag">Stronger version</span><h4>Returns to the real moment</h4><p>I still pause before jumping in with my own idea. That pause reminds me that leadership is not being the loudest person in the room; it is making enough space for the team to think clearly.</p></div>
                            </div>
                          </article>
                          <aside className="mockNotes">
                            <div className="endingScore"><div><b>84</b><span>Closure</span></div><div><b>71</b><span>Reflection</span></div><div><b>67</b><span>Memory</span></div></div>
                            <div className="mockNote"><strong>What works</strong><p>The ending restates the growth without introducing a new idea.</p></div>
                            <div className="mockNote"><strong>What to improve</strong><p>End with a concrete image instead of a broad lesson phrase.</p></div>
                          </aside>
                        </>
                      )}

                      {selectedTool === 'score' && (
                        <>
                          <article className="scoreDashboard">
                            <aside className="overallScore">
                              <div>
                                <small>Overall readiness</small>
                                <div className="bigScore">{toolResult?.score ?? 86}</div>
                              </div>
                              <div>
                                <h3>{toolResult?.headline ?? 'Strong draft with one evidence gap.'}</h3>
                                <p>{toolResult?.summary ?? 'The essay has a believable growth arc. Stronger concrete proof would make it feel more admissions-ready.'}</p>
                              </div>
                            </aside>

                            <section className="rubricGrid">
                              {[
                                ['Specificity', '82', 'Good moments are present, but two claims need sharper scenes.', '82%'],
                                ['Structure', '90', 'Clear beginning, turn, and ending. The order is easy to follow.', '90%'],
                                ['Voice', '88', 'The tone feels personal and not over-polished.', '88%'],
                                ['Reflection', '79', 'The lesson is clear but could connect more tightly to a future action.', '79%'],
                              ].map(([label, score, body, width]) => (
                                <div className="rubricCard" key={label}>
                                  <header><h4>{label}</h4><b>{score}</b></header>
                                  <div className="rubricBar"><i style={{ width }} /></div>
                                  <p>{body}</p>
                                </div>
                              ))}
                            </section>
                          </article>

                          <aside className="annotationBoard">
                            {[
                              ['Opening', 'Strong setup. Add one concrete sensory detail so the reader enters the moment faster.'],
                              ['Middle paragraph', 'This is the biggest opportunity: show what changed in your behavior, not only what you realized.'],
                              ['Evidence gap', 'The claim about team trust needs a result, quote, or visible response.'],
                              ['Recommended next step', 'Move this draft into Essay Studio and revise the middle paragraph first.'],
                            ].map(([title, body]) => (
                              <div className="annotation" key={title}>
                                <strong>{title}</strong>
                                <p>{body}</p>
                              </div>
                            ))}
                          </aside>
                        </>
                      )}

                      {selectedTool === 'prompt-fit' && (
                        <>
                          <article className="promptFitCard">
                            <div className="mockCardHead">
                              <h3>Prompt Requirements</h3>
                              <span className="mockTag">4 asks detected</span>
                            </div>
                            <div className="promptBody">
                              {[
                                ['1', 'Describe a challenge or setback you experienced.', 'Covered', true],
                                ['2', 'Explain what you did in response.', 'Covered', true],
                                ['3', 'Reflect on how the experience changed you.', 'Partial', false],
                                ['4', 'Connect that change to future goals or contribution.', 'Missing', false],
                              ].map(([num, body, status, good]) => (
                                <div className="promptLine" key={String(num)}>
                                  <span>{num}</span>
                                  <p>{body}</p>
                                  <b className={`status ${good ? 'good' : ''}`}>{status}</b>
                                </div>
                              ))}
                            </div>
                          </article>

                          <aside className="coverageCard">
                            <div className="mockCardHead">
                              <h3>Coverage Score</h3>
                              <span className="mockTag">Needs one addition</span>
                            </div>
                            <div className="coverageBody">
                              <div className="coverageRing">{toolResult?.score ?? 76}</div>
                              <div className="missList">
                                {[
                                  ['Missing ask', 'Add one sentence that shows how this growth affects what you will contribute next.'],
                                  ['Partial reflection', 'The essay says you changed, but it should show one new behavior that proves it.'],
                                  ['Suggested bridge', '“Now, before I lead with my own idea, I ask what the team has already noticed.”'],
                                ].map(([title, body]) => (
                                  <div className="missItem" key={title}>
                                    <b>{title}</b>
                                    <p>{body}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </aside>
                        </>
                      )}
                    </div>
                  )}
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
            box-shadow: 0 10px 28px rgba(15,23,42,.05);
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

          .admissionsHero {
            margin: -16px -16px 2px;
            border-radius: 22px 22px 0 0;
            background:
              radial-gradient(circle at 88% 20%, rgba(255,229,0,.28), transparent 28%),
              linear-gradient(135deg, ${NAVY}, #0b3f96);
            color: #fff;
            padding: 24px 26px;
            min-height: 138px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            overflow: hidden;
            position: relative;
          }

          .admissionsHero::after {
            content: "";
            position: absolute;
            right: -44px;
            bottom: -62px;
            width: 190px;
            height: 190px;
            border-radius: 44px;
            background: rgba(255,255,255,.08);
            transform: rotate(18deg);
          }

          .admissionsHero > * {
            position: relative;
            z-index: 1;
          }

          .admissionsHero span,
          .admitScore small {
            display: block;
            color: rgba(255,255,255,.75);
            font-size: 12px;
            font-weight: 900;
            letter-spacing: .15px;
          }

          .admissionsHero h3 {
            margin: 7px 0 7px;
            color: #fff;
            font-size: 22px;
            line-height: 1.15;
            font-weight: 900;
          }

          .admissionsHero p {
            max-width: 720px;
            margin: 0;
            color: rgba(255,255,255,.78);
            font-size: 14px;
            line-height: 1.55;
            font-weight: 700;
          }

          .admitScore {
            min-width: 118px;
            border: 1px solid rgba(255,255,255,.18);
            border-radius: 22px;
            padding: 15px 16px;
            background: rgba(255,255,255,.1);
            text-align: center;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.1);
          }

          .admitScore b {
            display: block;
            margin-top: 6px;
            color: ${YELLOW};
            font-size: 44px;
            line-height: .95;
            font-weight: 950;
          }

          .admissionsGrid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
          }

          .admissionCard {
            border: 1px solid #dfe8f6;
            border-radius: 18px;
            background:
              radial-gradient(circle at 95% 10%, rgba(255,229,0,.12), transparent 24%),
              #fff;
            padding: 16px;
            box-shadow: 0 10px 24px rgba(15,23,42,.045);
            min-width: 0;
          }

          .admissionCard.wide {
            grid-column: 1 / -1;
          }

          .admissionCard.nextMove {
            grid-column: 1 / -1;
            border-color: rgba(6,36,91,.18);
            background: linear-gradient(135deg, #fff, #f8fbff);
          }

          .admissionCardHead {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
          }

          .admissionCard h3 {
            margin: 0;
            color: ${NAVY};
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: .28px;
            font-weight: 950;
          }

          .admissionCard p {
            margin: 0;
            color: #64748b;
            font: 400 15px/1.75 'DM Sans', system-ui, sans-serif;
          }

          .admitTag {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 6px 9px;
            background: #edf4ff;
            color: ${NAVY};
            font-size: 10px;
            line-height: 1;
            font-weight: 950;
            white-space: nowrap;
          }

          .admitDot {
            width: 13px;
            height: 13px;
            border-radius: 999px;
            background: #94a3b8;
            box-shadow: 0 0 0 5px rgba(148,163,184,.16);
            flex: 0 0 auto;
          }

          .admitDot.good {
            background: #10b981;
            box-shadow: 0 0 0 5px rgba(16,185,129,.15);
          }

          .admitDot.warn {
            background: ${YELLOW};
            box-shadow: 0 0 0 5px rgba(255,229,0,.22);
          }

          .mockOutput {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(260px, .58fr);
            gap: 16px;
            width: 100%;
            min-width: 0;
          }

          .mockOutput > * {
            min-width: 0;
          }

          .mockOutput.thesis {
            grid-template-columns: minmax(0, 1fr);
          }

          .mockOutput.score {
            grid-template-columns: minmax(0, 1fr) minmax(280px, .52fr);
          }

          .mockOutput.prompt-fit {
            grid-template-columns: minmax(0, 1fr) minmax(260px, .58fr);
          }

          .mockCard,
          .compareCard {
            border: 1px solid #dfe8f6;
            border-radius: 18px;
            background: #fff;
            overflow: hidden;
            box-shadow: 0 10px 24px rgba(15,23,42,.045);
            min-width: 0;
          }

          .mockCardHead {
            padding: 14px 16px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
          }

          .mockCardHead h3 {
            margin: 0;
            color: ${NAVY};
            font-size: 13px;
            letter-spacing: .22px;
            text-transform: uppercase;
            font-weight: 900;
          }

          .mockTag {
            display: inline-flex;
            align-items: center;
            width: fit-content;
            border-radius: 999px;
            padding: 6px 9px;
            background: #edf4ff;
            color: ${NAVY};
            font-size: 10px;
            line-height: 1;
            font-weight: 900;
          }

          .mockResultBody {
            padding: 16px;
            display: grid;
            gap: 14px;
          }

          .mockScoreRow {
            display: grid;
            grid-template-columns: 96px 1fr;
            gap: 14px;
            align-items: center;
          }

          .mockScoreRing {
            width: 86px;
            height: 86px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            background: conic-gradient(${YELLOW} 0 282deg, #e8eef7 0);
            color: ${NAVY};
            font-size: 28px;
            font-weight: 950;
            box-shadow: inset 0 0 0 10px rgba(255,255,255,.75), 0 10px 24px rgba(15,23,42,.08);
          }

          .mockMeters {
            display: grid;
            gap: 9px;
          }

          .mockMeter {
            display: grid;
            gap: 5px;
            color: ${NAVY};
            font-size: 11px;
            font-weight: 900;
          }

          .mockMeter span,
          .strength {
            height: 8px;
            border-radius: 999px;
            background: #edf4ff;
            overflow: hidden;
          }

          .mockMeter i,
          .strength i {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: ${NAVY};
          }

          .mockInsightGrid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }

          .mockInsight,
          .mockNote,
          .sourceChip {
            border: 1px solid #dfe8f6;
            border-radius: 15px;
            padding: 12px;
            background: #f8fbff;
          }

          .mockInsight b,
          .mockNote strong,
          .sourceChip b {
            display: block;
            color: ${NAVY};
            font-size: 13px;
            margin-bottom: 6px;
            font-weight: 900;
          }

          .mockInsight p,
          .mockNote p,
          .sourceChip p {
            margin: 0;
            color: #64748b;
            font-size: 12px;
            line-height: 1.45;
            font-weight: 700;
          }

          .outlineStack,
          .evidenceMap,
          .endingPreview,
          .mockNotes,
          .sourceCard,
          .fixList {
            padding: 16px;
            display: grid;
            gap: 12px;
          }

          .outlineStep {
            display: grid;
            grid-template-columns: 36px 1fr;
            gap: 12px;
            padding: 13px;
            border: 1px solid #dfe8f6;
            border-radius: 16px;
            background: #fff;
            box-shadow: 0 8px 18px rgba(15,23,42,.04);
          }

          .outlineStep span,
          .fixItem > span {
            width: 36px;
            height: 36px;
            border-radius: 999px;
            display: grid;
            place-items: center;
            background: ${NAVY};
            color: ${YELLOW};
            font-weight: 950;
          }

          .outlineStep h4 {
            margin: 0 0 4px;
            color: ${NAVY};
            font-size: 14px;
            font-weight: 900;
          }

          .outlineStep p {
            margin: 0;
            color: #64748b;
            font-size: 12px;
            line-height: 1.45;
            font-weight: 700;
          }

          .compareBody {
            display: grid;
            grid-template-columns: 1fr 1fr;
            min-height: 395px;
          }

          .draftSide,
          .fixedSide {
            padding: 16px;
            font-size: 14px;
            line-height: 1.72;
            font-weight: 650;
          }

          .draftSide {
            color: #64748b;
            background: #fbfdff;
            border-right: 1px solid #e2e8f0;
          }

          .fixedSide {
            color: #26364d;
            background:
              radial-gradient(circle at 94% 8%, rgba(255,229,0,.18), transparent 28%),
              #fff;
          }

          .fixedSide span {
            border-radius: 8px;
            padding: 1px 4px;
            background: rgba(255,229,0,.45);
            color: ${NAVY};
            font-weight: 900;
          }

          .fixItem {
            display: grid;
            grid-template-columns: 34px 1fr;
            gap: 10px;
            padding: 12px;
            border: 1px solid #dfe8f6;
            border-radius: 15px;
            background: #f8fbff;
          }

          .fixItem > span {
            width: 34px;
            height: 34px;
            border-radius: 12px;
            font-size: 13px;
          }

          .fixItem b {
            display: block;
            color: ${NAVY};
            font-size: 13px;
            margin-bottom: 4px;
          }

          .fixItem p {
            margin: 0;
            color: #64748b;
            font-size: 12px;
            line-height: 1.42;
            font-weight: 700;
          }

          .claimRow {
            display: grid;
            grid-template-columns: 76px 1fr 86px;
            gap: 12px;
            align-items: center;
            padding: 13px;
            border: 1px solid #dfe8f6;
            border-radius: 16px;
            background: #fff;
          }

          .claimRow strong {
            color: ${NAVY};
            font-size: 12px;
          }

          .claimRow p {
            margin: 0;
            color: #475569;
            font-size: 12px;
            line-height: 1.42;
            font-weight: 700;
          }

          .sourceChip,
          .mockNote {
            background: linear-gradient(135deg, #fff, #f8fbff);
          }

          .endingCard {
            border: 1px solid #dfe8f6;
            border-radius: 17px;
            padding: 15px;
            background: #fff;
            position: relative;
            overflow: hidden;
          }

          .endingCard::after {
            content: "";
            position: absolute;
            right: -36px;
            bottom: -42px;
            width: 120px;
            height: 120px;
            border-radius: 34px;
            background: rgba(255,229,0,.22);
            transform: rotate(14deg);
          }

          .endingCard > * {
            position: relative;
            z-index: 1;
          }

          .endingCard h4 {
            margin: 10px 0 8px;
            color: ${NAVY};
            font-size: 14px;
            font-weight: 900;
          }

          .endingCard p {
            margin: 0;
            color: #334155;
            font-size: 14px;
            line-height: 1.62;
            font-weight: 650;
          }

          .endingScore {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
          }

          .endingScore div {
            border: 1px solid #dfe8f6;
            border-radius: 15px;
            padding: 12px;
            background: #f8fbff;
          }

          .endingScore b {
            display: block;
            color: ${NAVY};
            font-size: 22px;
            line-height: 1;
            margin-bottom: 5px;
          }

          .endingScore span {
            color: #64748b;
            font-size: 11px;
            font-weight: 900;
          }

          .scoreDashboard,
          .promptFitCard,
          .coverageCard,
          .annotationBoard {
            border: 1px solid #dfe8f6;
            border-radius: 20px;
            background: #fff;
            box-shadow: 0 12px 28px rgba(15,23,42,.055);
            overflow: hidden;
            min-width: 0;
          }

          .scoreDashboard {
            display: grid;
            grid-template-columns: 260px 1fr;
            gap: 16px;
            padding: 16px;
            background:
              radial-gradient(circle at 96% 8%, rgba(255,229,0,.2), transparent 28%),
              #fff;
          }

          .overallScore {
            border-radius: 18px;
            background: ${NAVY};
            color: #fff;
            padding: 20px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            min-height: 280px;
          }

          .overallScore small {
            display: block;
            margin-bottom: 14px;
            color: rgba(255,255,255,.72);
            font-size: 12px;
            font-weight: 900;
            letter-spacing: .2px;
          }

          .bigScore {
            color: ${YELLOW};
            font-size: 68px;
            line-height: .9;
            font-weight: 950;
          }

          .overallScore h3 {
            margin: 0 0 8px;
            color: #fff;
            font-size: 18px;
            line-height: 1.15;
            font-weight: 900;
          }

          .overallScore p {
            margin: 0;
            color: rgba(255,255,255,.78);
            font-size: 13px;
            line-height: 1.5;
            font-weight: 700;
          }

          .rubricGrid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .rubricCard {
            border: 1px solid #dfe8f6;
            border-radius: 16px;
            padding: 14px;
            background: rgba(248,251,255,.92);
          }

          .rubricCard header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
          }

          .rubricCard h4 {
            margin: 0;
            color: ${NAVY};
            font-size: 13px;
            font-weight: 900;
          }

          .rubricCard b {
            color: ${NAVY};
            font-size: 22px;
            line-height: 1;
            font-weight: 950;
          }

          .rubricBar {
            height: 8px;
            border-radius: 999px;
            background: #e8eef7;
            overflow: hidden;
            margin-bottom: 10px;
          }

          .rubricBar i {
            display: block;
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, ${NAVY}, #0f4fb7);
          }

          .rubricCard p,
          .annotation p,
          .promptLine p,
          .missItem p {
            margin: 0;
            color: #64748b;
            font-size: 12px;
            line-height: 1.45;
            font-weight: 700;
          }

          .annotationBoard {
            display: grid;
            gap: 12px;
            padding: 16px;
            background: linear-gradient(135deg, #fff, #f8fbff);
          }

          .annotation,
          .missItem {
            border: 1px solid #dfe8f6;
            border-radius: 15px;
            padding: 13px;
            background: #fff;
          }

          .annotation strong,
          .missItem b {
            display: block;
            margin-bottom: 6px;
            color: ${NAVY};
            font-size: 13px;
            font-weight: 900;
          }

          .promptBody {
            display: grid;
            gap: 12px;
            padding: 16px;
          }

          .promptLine {
            display: grid;
            grid-template-columns: 38px minmax(0, 1fr) 78px;
            align-items: center;
            gap: 12px;
            border: 1px solid #dfe8f6;
            border-radius: 16px;
            padding: 13px;
            background: #fff;
          }

          .promptLine span {
            width: 38px;
            height: 38px;
            border-radius: 14px;
            display: grid;
            place-items: center;
            background: ${NAVY};
            color: ${YELLOW};
            font-size: 13px;
            font-weight: 950;
          }

          .status {
            justify-self: end;
            border-radius: 999px;
            padding: 6px 9px;
            background: #fff5cc;
            color: #7a5f00;
            font-size: 10px;
            line-height: 1;
            font-weight: 950;
          }

          .status.good {
            background: #dcfce7;
            color: #047857;
          }

          .coverageCard {
            display: flex;
            flex-direction: column;
          }

          .coverageBody {
            padding: 16px;
            display: grid;
            gap: 14px;
          }

          .coverageRing {
            width: 104px;
            height: 104px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            justify-self: center;
            background: conic-gradient(${YELLOW} 0 274deg, #e8eef7 0);
            color: ${NAVY};
            font-size: 34px;
            font-weight: 950;
            box-shadow: inset 0 0 0 12px #fff, 0 12px 30px rgba(15,23,42,.08);
          }

          .missList {
            display: grid;
            gap: 10px;
          }

          @media (max-width: 1100px) {
            .launchArea {
              grid-template-columns: 1fr;
            }

            .mockOutput,
            .mockOutput.score,
            .mockOutput.prompt-fit,
            .scoreDashboard {
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

            .admissionsHero {
              align-items: flex-start;
              flex-direction: column;
            }

            .admissionsGrid {
              grid-template-columns: 1fr;
            }

            .mockInsightGrid,
            .compareBody {
              grid-template-columns: 1fr;
            }

            .draftSide {
              border-right: 0;
              border-bottom: 1px solid #e2e8f0;
            }

            .claimRow {
              grid-template-columns: 1fr;
              align-items: stretch;
            }

            .mockScoreRow,
            .endingScore,
            .rubricGrid,
            .promptLine {
              grid-template-columns: 1fr;
            }

            .promptLine span,
            .status {
              justify-self: start;
            }
          }
        `}</style>
      </main>
    </AppShell>
  );
}
