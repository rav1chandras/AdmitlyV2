'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useProCheck } from '@/lib/useProCheck';
import { timeAgo, wordCount } from '@/lib/utils';

type CoachTab = 'coach' | 'review' | 'inspiration';
type EditorTab = 'draft' | 'fine-tune' | 'review';
type AiState = 'idle' | 'generating' | 'error';

interface UserCollege {
  id: number;
  name: string;
  bucket: 'reach' | 'target' | 'safety';
}

interface EssayDraft {
  id: number;
  college_id: number | null;
  college_name: string | null;
  essay_type: string;
  topic: string;
  draft_text: string;
  word_count: number;
  prompt_source: string;
  audience: string;
  tone_chips: string;
  formality: number;
  word_limit: number;
  narrative_focus: number;
  status: 'draft' | 'submitted';
  updated_at: string;
  shared_with_counselor?: boolean;
  expert_tag?: string | null;
  source_essay_id?: number | null;
}

interface ScoreResult {
  overall_score?: number;
  overall_verdict?: string;
  percentile?: number;
  dimensions?: { name: string; score: number; feedback: string; quote?: string }[];
  top_3_improvements?: string[];
  strongest_sentence?: string;
  weakest_sentence?: string;
}

interface HookResult {
  overall_score?: number;
  one_line_verdict?: string;
  rewrite_suggestion?: string;
  intrigue_score?: number;
  clarity_score?: number;
  originality_score?: number;
}

interface ReaderResult {
  overall_score?: number;
  first_impression?: string;
  would_remember?: string;
  verdict_sentence?: string;
  key_strengths?: string[];
  key_concerns?: string[];
}

interface ExpertStatus {
  counselor?: { name: string; title: string; initials: string } | null;
  assignment?: { id: number; plan: string; status: string; sessionsTotal?: number; sessionsUsed?: number } | null;
  needsAssignment?: boolean;
}

const ESSAY_TYPE_OPTIONS = [
  { value: 'personal_statement', label: 'Personal Statement' },
  { value: 'why_school', label: 'Why This School' },
  { value: 'academic', label: 'Academic Interest' },
  { value: 'activity', label: 'Interest / Activity' },
  { value: 'challenge', label: 'Personal Challenge' },
  { value: 'program', label: 'Program Specific' },
  { value: 'other', label: 'Something Else' },
];

const ESSAY_TYPE_LABELS: Record<string, string> = {
  personal_statement: 'Personal Statement',
  why_school: 'Why This School',
  academic: 'Academic Interest',
  activity: 'Interest / Activity',
  challenge: 'Personal Challenge',
  program: 'Program Specific',
  other: 'General Essay',
};

const TONE_OPTIONS = ['Reflective', 'Narrative', 'Analytical', 'Conversational', 'Bold', 'Natural'];
const VOICE_WORD_MIN = 50;
const VOICE_WORD_MAX = 650;
const ESSAY_NAVY = '#06245B';
const PROMPT_CHAR_MAX = 3000;

const FINE_TUNE_ACTIONS = [
  'Refine selection',
  'Strengthen hook',
  'Add specificity',
  'Make voice more natural',
  'Tighten structure',
];

const ss = (o: React.CSSProperties) => o;

function stripHtml(value: string): string {
  return (value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(p|div|blockquote)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value: string): string {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function draftToEditorHtml(value: string): string {
  if (!value) return '';
  if (/<(b|strong|i|em|blockquote|ul|ol|li|p|div|br)\b/i.test(value)) return value;
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_]+)_/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
}

function limitWords(value: string, limit: number): string {
  const max = Math.max(1, (limit || 1) + 50);
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return value;
  return words.slice(0, max).join(' ');
}

function limitToWordCount(value: string, limit: number): string {
  const max = Math.max(1, limit || 1);
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return value;
  return words.slice(0, max).join(' ');
}

function limitPrompt(value: string, limit: number): string {
  return limitToWordCount(value || '', limit).slice(0, PROMPT_CHAR_MAX);
}

function draftTitle(draft: EssayDraft | null, essayType: string, topicInput: string): string {
  return ESSAY_TYPE_LABELS[draft?.essay_type || essayType] ?? 'Untitled Essay';
}

function initials(name?: string | null) {
  return (name || 'Expert Counselor').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function EssayMockupPage() {
  const { status } = useSession();
  const router = useRouter();
  const { isPaid } = useProCheck();

  const [drafts, setDrafts] = useState<EssayDraft[]>([]);
  const [userColleges, setUserColleges] = useState<UserCollege[]>([]);
  const [expertStatus, setExpertStatus] = useState<ExpertStatus | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'common' | 'supplemental' | 'shared'>('all');

  const [essayType, setEssayType] = useState('personal_statement');
  const [collegeId, setCollegeId] = useState<number | null>(null);
  const [topicInput, setTopicInput] = useState('');
  const [draftText, setDraftText] = useState('');
  const [toneChips, setToneChips] = useState<string[]>(['Reflective']);
  const [formality, setFormality] = useState(3);
  const [wordLimit, setWordLimit] = useState(650);
  const [narrativeFocus, setNarrativeFocus] = useState(2);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Ready');

  const [editorTab, setEditorTab] = useState<EditorTab>('draft');
  const [coachTab, setCoachTab] = useState<CoachTab>('coach');
  const [selectedTunes, setSelectedTunes] = useState<string[]>(['Refine selection']);
  const [refineInstructions, setRefineInstructions] = useState('');
  const [toast, setToast] = useState('');

  const [aiState, setAiState] = useState<AiState>('idle');
  const [aiMode, setAiMode] = useState<'generate' | 'improve'>('generate');
  const [aiError, setAiError] = useState('');
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);
  const [journeyGrounded, setJourneyGrounded] = useState<boolean | null>(null);
  const [useJourney, setUseJourney] = useState(false);
  const [useVoice, setUseVoice] = useState(false);
  const [voiceSamples, setVoiceSamples] = useState<string[]>(['', '', '', '', '']);
  const [voiceSaving, setVoiceSaving] = useState(false);

  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreError, setScoreError] = useState('');
  const [hookResult, setHookResult] = useState<HookResult | null>(null);
  const [hookLoading, setHookLoading] = useState(false);
  const [readerResult, setReaderResult] = useState<ReaderResult | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const activeDraft = useMemo(() => drafts.find(d => d.id === activeId) ?? null, [drafts, activeId]);
  const draftPlainText = useMemo(() => stripHtml(draftText), [draftText]);
  const wc = wordCount(draftPlainText);
  const wordPct = Math.min(100, Math.round((wc / Math.max(1, wordLimit)) * 100));
  const sharedCount = drafts.filter(d => d.shared_with_counselor).length;
  const activeDraftCount = drafts.filter(d => d.status !== 'submitted' && !d.expert_tag).length;
  const expertReviewCount = drafts.filter(d => d.expert_tag).length;
  const validVoiceSamples = voiceSamples.filter(sample => wordCount(sample) >= VOICE_WORD_MIN).length;

  const loadDraft = useCallback((draft: EssayDraft) => {
    setActiveId(draft.id);
    setEssayType(draft.essay_type || 'personal_statement');
    setCollegeId(draft.college_id ?? null);
    setTopicInput(draft.topic || '');
    setDraftText(draft.draft_text || '');
    setToneChips(draft.tone_chips ? draft.tone_chips.split(',').filter(Boolean) : ['Reflective']);
    setFormality(draft.formality || 3);
    setWordLimit(draft.word_limit || 650);
    setNarrativeFocus(draft.narrative_focus || 2);
    setIsDirty(false);
    setSaveStatus('Saved');
    setScoreResult(null);
    setHookResult(null);
    setReaderResult(null);
    setScoreError('');
  }, []);

  const fetchExpertStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/expert-portal', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setExpertStatus({
        counselor: data.counselor ? {
          name: data.counselor.name,
          title: data.counselor.title,
          initials: data.counselor.initials || initials(data.counselor.name),
        } : null,
        assignment: data.assignment ? {
          id: data.assignment.id,
          plan: data.assignment.plan,
          status: data.assignment.status,
          sessionsTotal: data.assignment.sessionsTotal,
          sessionsUsed: data.assignment.sessionsUsed,
        } : null,
        needsAssignment: !!data.needsAssignment,
      });
    } catch {
      setExpertStatus(null);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [essayRes, collegeRes, voiceRes] = await Promise.all([
        fetch('/api/essays', { cache: 'no-store' }),
        fetch('/api/colleges', { cache: 'no-store' }),
        fetch('/api/essays?action=voice_samples', { cache: 'no-store' }),
      ]);

      if (essayRes.ok) {
        const data: EssayDraft[] = await essayRes.json();
        setDrafts(data);
        const nextActive = activeId ? data.find(d => d.id === activeId) : data[0];
        if (nextActive) loadDraft(nextActive);
        else {
          setActiveId(null);
          setEssayType('personal_statement');
          setCollegeId(null);
          setTopicInput('');
          setDraftText('');
          setIsDirty(false);
          setSaveStatus('Ready');
        }
      }

      if (collegeRes.ok) {
        const colleges = await collegeRes.json();
        if (Array.isArray(colleges)) {
          setUserColleges(colleges.map((c: any) => ({ id: c.id, name: c.name, bucket: c.bucket ?? 'target' })));
        }
      }

      if (voiceRes.ok) {
        const voice = await voiceRes.json();
        if (Array.isArray(voice.samples)) setVoiceSamples([...voice.samples, '', '', '', '', ''].slice(0, 5));
      }
    } catch (err) {
      console.error('[essay-studio] fetch failed', err);
      setToast('Could not load essays. Please refresh.');
    } finally {
      setIsLoading(false);
    }
  }, [activeId, loadDraft]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchAll();
      fetchExpertStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const nextHtml = draftToEditorHtml(draftText);
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
  }, [draftText, activeId]);

  function markDirty() {
    setIsDirty(true);
    setSaveStatus('Unsaved changes');
  }

  function setField<T>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) {
    setter(value);
    markDirty();
  }

  function toggleTone(tone: string) {
    setToneChips(prev => {
      const next = prev.includes(tone) ? prev.filter(t => t !== tone) : [...prev, tone];
      return next.length ? next : ['Reflective'];
    });
    markDirty();
  }

  function toggleTune(action: string) {
    setSelectedTunes(prev => {
      const next = prev.includes(action) ? prev.filter(item => item !== action) : [...prev, action];
      return next.length ? next : ['Refine selection'];
    });
  }

  function buildPayload(statusOverride?: 'draft' | 'submitted') {
    const college = userColleges.find(c => c.id === collegeId);
    const editorHtml = editorRef.current?.innerHTML;
    const currentDraftText = editorHtml !== undefined ? editorHtml : draftText;
    const currentDraftPlainText = stripHtml(currentDraftText);
    return {
      essay_type: essayType,
      college_id: collegeId,
      college_name: college?.name ?? null,
      topic: topicInput,
      draft_text: currentDraftText,
      word_count: wordCount(currentDraftPlainText),
      prompt_source: 'Common App',
      audience: 'Admissions Officer',
      tone_chips: toneChips.join(','),
      formality,
      word_limit: wordLimit,
      narrative_focus: narrativeFocus,
      status: statusOverride ?? activeDraft?.status ?? 'draft',
    };
  }

  async function saveAsNew(silent = false, statusOverride: 'draft' | 'submitted' = 'draft'): Promise<EssayDraft | null> {
    setSaveStatus('Saving…');
    try {
      const res = await fetch('/api/essays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(statusOverride)),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create essay');
      const created: EssayDraft = await res.json();
      setDrafts(prev => [created, ...prev]);
      loadDraft(created);
      if (!silent) setToast('New essay saved.');
      return created;
    } catch (err: any) {
      setSaveStatus('Save failed');
      setToast(err.message || 'Save failed.');
      return null;
    }
  }

  async function updateDraft(statusOverride?: 'draft' | 'submitted', silent = false): Promise<EssayDraft | null> {
    if (!activeId) return saveAsNew(silent, statusOverride ?? 'draft');
    setSaveStatus('Saving…');
    try {
      const res = await fetch('/api/essays', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeId, ...buildPayload(statusOverride) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save essay');
      const updated: EssayDraft = await res.json();
      setDrafts(prev => prev.map(d => d.id === updated.id ? updated : d));
      setIsDirty(false);
      setSaveStatus('Saved just now');
      if (!silent) setToast(statusOverride === 'submitted' ? 'Marked ready for review.' : 'Essay saved.');
      return updated;
    } catch (err: any) {
      setSaveStatus('Save failed');
      setToast(err.message || 'Save failed.');
      return null;
    }
  }

  async function deleteDraft(id: number) {
    if (!confirm('Delete this essay draft?')) return;
    try {
      await fetch(`/api/essays?id=${id}`, { method: 'DELETE' });
      const remaining = drafts.filter(d => d.id !== id);
      setDrafts(remaining);
      if (activeId === id) {
        if (remaining.length) loadDraft(remaining[0]);
        else newDraft();
      }
      setToast('Draft deleted.');
    } catch {
      setToast('Delete failed.');
    }
  }

  function newDraft() {
    setActiveId(null);
    setEssayType('personal_statement');
    setCollegeId(null);
    setTopicInput('');
    setDraftText('');
    setToneChips(['Reflective']);
    setFormality(3);
    setWordLimit(650);
    setNarrativeFocus(2);
    setIsDirty(false);
    setSaveStatus('New unsaved draft');
    setScoreResult(null);
    setHookResult(null);
    setReaderResult(null);
    setEditorTab('draft');
    setTimeout(() => promptRef.current?.focus(), 0);
  }

  async function toggleEssayShare(id: number, shared: boolean) {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, shared_with_counselor: shared } : d));
    try {
      const res = await fetch('/api/essays', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, shared_with_counselor: shared }),
      });
      if (!res.ok) throw new Error('Share update failed');
      const updated = await res.json();
      setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...updated } : d));
      setToast(shared ? 'Shared with expert counselors.' : 'Sharing turned off.');
    } catch {
      setDrafts(prev => prev.map(d => d.id === id ? { ...d, shared_with_counselor: !shared } : d));
      setToast('Could not update sharing.');
    }
  }

  async function shareActiveForReview() {
    let id = activeId;
    const nextShared = activeDraft ? !activeDraft.shared_with_counselor : true;
    if (!id) {
      const created = await saveAsNew(true);
      id = created?.id ?? null;
    } else if (isDirty) {
      await updateDraft(undefined, true);
    }
    if (!id) return;
    await toggleEssayShare(id, nextShared);
    if (nextShared) setCoachTab('review');
  }

  async function saveVoiceSamples() {
    setVoiceSaving(true);
    try {
      const res = await fetch('/api/essays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_voice_samples', samples: voiceSamples }),
      });
      if (!res.ok) throw new Error('Could not save voice samples');
      setToast('Voice samples saved.');
    } catch (err: any) {
      setToast(err.message || 'Could not save voice samples.');
    } finally {
      setVoiceSaving(false);
    }
  }

  function selectedText() {
    const el = editorRef.current;
    if (!el) return '';
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return '';
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return '';
    return selection.toString().trim();
  }

  function tuneInstruction() {
    const selection = selectedText();
    const base: Record<string, string> = {
      'Refine selection': selection ? `Refine this selected passage while keeping the rest of the essay coherent: "${selection}"` : 'Refine the current draft for clarity, specificity, and flow.',
      'Strengthen hook': 'Strengthen the opening hook. Start with a vivid, specific moment and cut generic setup.',
      'Add specificity': 'Add concrete details, sensory information, and specific actions. Remove vague claims.',
      'Make voice more natural': 'Make the draft sound more like a thoughtful student, not a polished template. Keep it natural and sincere.',
      'Tighten structure': 'Improve paragraph order, transitions, narrative arc, and conclusion payoff. If the draft is over the word limit, cut repeated setup and summary while preserving the strongest details.',
    };
    const selectedInstructions = selectedTunes.map(tune => base[tune] ?? tune);
    return [...selectedInstructions, refineInstructions.trim()].filter(Boolean).join('\n');
  }

  function activeVoiceSamples() {
    return useVoice ? voiceSamples.filter(sample => wordCount(sample) >= VOICE_WORD_MIN) : [];
  }

  async function generateWithAI(mode: 'generate' | 'improve', instructions = '') {
    setAiState('generating');
    setAiMode(mode);
    setAiError('');
    setEditorTab(mode === 'improve' ? 'fine-tune' : 'draft');
    const college = userColleges.find(c => c.id === collegeId);
    const activeSamples = activeVoiceSamples();

    try {
      const res = await fetch('/api/essays/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          essay_type: essayType,
          college_name: college?.name ?? null,
          topic: topicInput,
          existing_draft: mode === 'improve' ? draftPlainText : '',
          tone_chips: toneChips,
          formality,
          word_limit: wordLimit,
          narrative_focus: narrativeFocus,
          prompt_source: 'Common App',
          audience: 'Admissions Officer',
          mode,
          use_journey: useJourney,
          voice_samples: activeSamples,
          refine_instructions: mode === 'improve' ? instructions : '',
        }),
      });

      const grounded = res.headers.get('X-Journey-Grounded');
      if (grounded !== null) setJourneyGrounded(grounded === 'true');
      const remaining = res.headers.get('X-AI-Remaining');
      if (remaining !== null) setAiRemaining(parseInt(remaining, 10));

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'AI generation failed');
      }
      if (!res.body) throw new Error('No response body from AI');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      if (mode === 'generate') setDraftText('');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setDraftText(acc);
      }
      setDraftText(acc.trim());
      setIsDirty(true);
      setSaveStatus('AI draft ready — save changes');
      setAiState('idle');
      setToast(mode === 'generate' ? 'AI draft generated.' : 'Fine-tune applied.');
    } catch (err: any) {
      setAiError(err.message || 'AI generation failed');
      setAiState('error');
      setToast(err.message || 'AI generation failed');
      setTimeout(() => setAiState('idle'), 4500);
    }
  }

  function syncEditorState() {
    const el = editorRef.current;
    if (!el) return;
    const limitedText = limitWords(stripHtml(el.innerHTML), wordLimit);
    const wasOverLimit = wordCount(stripHtml(el.innerHTML)) > wordLimit;
    if (wasOverLimit) el.innerHTML = draftToEditorHtml(limitedText);
    setDraftText(wasOverLimit ? draftToEditorHtml(limitedText) : el.innerHTML);
    markDirty();
  }

  function pastePlainText(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    const currentWords = wordCount(stripHtml(editorRef.current?.innerHTML || ''));
    const selectedWords = wordCount(selectedText());
    const remaining = Math.max(0, wordLimit + 50 - currentWords + selectedWords);
    if (remaining <= 0) return;
    document.execCommand('insertText', false, limitWords(text, remaining));
    syncEditorState();
  }

  function updatePrompt(value: string) {
    setTopicInput(limitPrompt(value, wordLimit));
    markDirty();
  }

  function updateWordLimit(nextLimit: number) {
    const limited = Math.min(1800, Math.max(50, nextLimit || 650));
    setWordLimit(limited);
    setTopicInput(prev => limitPrompt(prev, limited));
    setDraftText(prev => {
      const limitedText = limitWords(stripHtml(prev), limited);
      const nextHtml = draftToEditorHtml(limitedText);
      if (editorRef.current && wordCount(stripHtml(prev)) > limited) editorRef.current.innerHTML = nextHtml;
      return wordCount(stripHtml(prev)) > limited ? nextHtml : prev;
    });
    markDirty();
  }

  function runEditorCommand(event: React.MouseEvent<HTMLButtonElement>, command: string, value?: string) {
    event.preventDefault();
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, value);
    syncEditorState();
  }

  function exportText() {
    const label = ESSAY_TYPE_LABELS[essayType] ?? essayType;
    const college = userColleges.find(c => c.id === collegeId)?.name || activeDraft?.college_name || '';
    const filename = `${label}${college ? ` - ${college}` : ''}.txt`.replace(/[/\\?%*:|"<>]/g, '-');
    const content = [`${label}${college ? ` — ${college}` : ''}`, topicInput ? `Prompt: ${topicInput}` : '', `Word count: ${wc} / ${wordLimit}`, '', draftPlainText || '(No content yet)'].filter(Boolean).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const label = ESSAY_TYPE_LABELS[essayType] ?? essayType;
    const escaped = (draftPlainText || '(No content yet)').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${label}</title><style>body{font-family:DM Sans,Arial,sans-serif;color:#1c1917;padding:42px 54px;line-height:1.75}.meta{color:#78716c;font-size:12px}h1{font-size:22px;margin-bottom:6px}.essay{white-space:normal;font-size:14px}.wc{text-align:right;color:#a8a29e;font-size:11px;margin-top:28px}</style></head><body><h1>${label}</h1><div class="meta">${topicInput || 'No prompt specified'}</div><hr/><div class="essay">${escaped}</div><div class="wc">${wc} / ${wordLimit} words</div></body></html>`;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 250);
  }

  async function runScore() {
    setScoreError('');
    if (wc < 50) {
      setScoreError('Write at least 50 words before running a review.');
      return;
    }
    setScoreLoading(true);
    try {
      const res = await fetch('/api/essays/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ essay: draftPlainText, essay_type: ESSAY_TYPE_LABELS[essayType] ?? essayType, college_name: userColleges.find(c => c.id === collegeId)?.name ?? '', use_journey: useJourney, voice_samples: activeVoiceSamples() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Review failed');
      const data = await res.json();
      setScoreResult(data);
      setEditorTab('review');
      setCoachTab('review');
      setToast('Essay review complete.');
    } catch (err: any) {
      setScoreError(err.message || 'Review failed.');
    } finally {
      setScoreLoading(false);
    }
  }

  async function runHook() {
    if (wordCount(draftPlainText) < 15) {
      setScoreError('Write at least 15 words before analyzing the hook.');
      return;
    }
    setHookLoading(true);
    setScoreError('');
    try {
      const res = await fetch('/api/essays/hook-analyzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ essay: draftPlainText, essay_type: ESSAY_TYPE_LABELS[essayType] ?? essayType, use_journey: useJourney, voice_samples: activeVoiceSamples() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Hook analysis failed');
      setHookResult(await res.json());
      setEditorTab('review');
      setToast('Hook analysis complete.');
    } catch (err: any) {
      setScoreError(err.message || 'Hook analysis failed.');
    } finally {
      setHookLoading(false);
    }
  }

  async function runReader() {
    if (wc < 50) {
      setScoreError('Write at least 50 words before simulating a reader.');
      return;
    }
    setReaderLoading(true);
    setScoreError('');
    try {
      const res = await fetch('/api/essays/reader-simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ essay: draftPlainText, essay_type: ESSAY_TYPE_LABELS[essayType] ?? essayType, reader_role: 'admissions_officer', selectivity_tier: 'selective', use_journey: useJourney, voice_samples: activeVoiceSamples() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Reader simulation failed');
      setReaderResult(await res.json());
      setEditorTab('review');
      setToast('Reader simulation complete.');
    } catch (err: any) {
      setScoreError(err.message || 'Reader simulation failed.');
    } finally {
      setReaderLoading(false);
    }
  }

  async function runFullReview() {
    if (wc < 50) {
      setScoreError('Write at least 50 words before running a review.');
      return;
    }
    await Promise.all([runScore(), runHook(), runReader()]);
  }

  const filteredDrafts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return drafts.filter(d => {
      if (libraryFilter === 'shared' && !d.shared_with_counselor) return false;
      if (libraryFilter === 'common' && d.essay_type !== 'personal_statement') return false;
      if (libraryFilter === 'supplemental' && d.essay_type === 'personal_statement') return false;
      if (!q) return true;
      return [d.topic, d.college_name, ESSAY_TYPE_LABELS[d.essay_type], d.draft_text].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [drafts, libraryFilter, searchQuery]);

  const currentCollegeName = userColleges.find(c => c.id === collegeId)?.name || activeDraft?.college_name || '';

  if (status === 'loading') {
    return <div style={ss({ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontWeight: 800, color: 'var(--stone-400)' })}>Loading…</div>;
  }

  return (
    <AppShell>
      <style>{`
        .essay-studio-layout { display:grid; grid-template-columns:300px minmax(0,1fr) 330px; gap:16px; align-items:start; }
        .essay-textarea::placeholder, .essay-input::placeholder { color: var(--stone-300); }
        .essay-rich-editor:empty::before { content: attr(data-placeholder); color: var(--stone-300); pointer-events: none; }
        .essay-rich-editor blockquote { margin: 0 0 0 8px; padding-left: 12px; border-left: 3px solid var(--border); color: var(--stone-600); }
        .essay-rich-editor ul { margin: 0; padding-left: 22px; }
        @media (max-width: 1280px) { .essay-studio-layout { grid-template-columns:280px minmax(0,1fr); } .essay-coach { grid-column:1 / -1; } }
        @media (max-width: 900px) { .essay-studio-layout { grid-template-columns:1fr; } }
      `}</style>
      <main style={ss({ flex: 1, overflowY: 'auto', background: 'linear-gradient(180deg,#fafaf9,#f5f5f4)' })}>
        <div style={ss({ maxWidth: 1480, margin: '0 auto', padding: '28px 24px 42px' })}>
          <header style={ss({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap', marginBottom: 24 })}>
            <div>
              <h1 style={ss({ margin: 0, fontSize: 24, lineHeight: 1.1, fontWeight: 800, color: '#0f172a', letterSpacing: 0 })}>Essay Studio</h1>
              <p style={ss({ margin: '6px 0 0', color: '#64748b', fontSize: 13, fontWeight: 600 })}>Write with purpose, fine-tune with AI, and share drafts with expert counselors.</p>
            </div>
          </header>

          {!isPaid && (
            <div style={ss({ ...card({ padding: 16, marginBottom: 16, background: '#FFFBEA', borderColor: '#F2E3A6' }), display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' })}>
              <div style={ss({ display: 'flex', alignItems: 'center', gap: 12 })}>
                <div style={ss({ width: 36, height: 36, borderRadius: 12, background: 'var(--yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center' })}><i className="fas fa-crown"></i></div>
                <div><div style={ss({ fontSize: 14, fontWeight: 900 })}>Pro unlocks AI generation and essay coaching.</div><div style={ss({ fontSize: 12, color: 'var(--stone-500)', marginTop: 3 })}>Drafting, saving, exporting, and counselor sharing still work in Essay Studio.</div></div>
              </div>
              <button onClick={() => router.push('/subscribe')} style={btnPrimary}>Upgrade to Pro</button>
            </div>
          )}

          <section className="essay-studio-layout">
            <aside style={ss({ display: 'flex', flexDirection: 'column', gap: 14 })}>
              <div style={card({ padding: 16 })}>
                <div style={ss({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 })}>
                  <div style={eyebrow}>Essay library</div>
                  <span style={pill('var(--yellow)', ESSAY_NAVY)}>{drafts.length} drafts</span>
                </div>
                <div style={ss({ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--stone-50)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 })}>
                  <i className="fas fa-magnifying-glass" style={{ color: 'var(--stone-400)', fontSize: 12 }}></i>
                  <input className="essay-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search essays" style={ss({ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 13, color: 'var(--stone-800)' })} />
                </div>
                <div style={ss({ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 })}>
                  {([
                    ['all', 'All'], ['common', 'Common App'], ['supplemental', 'Supplementals'], ['shared', 'Shared'],
                  ] as const).map(([id, label]) => <button key={id} onClick={() => setLibraryFilter(id)} style={filterPill(libraryFilter === id)}>{label}</button>)}
                </div>

                <div style={ss({ display: 'flex', flexDirection: 'column', gap: 10 })}>
                  {isLoading ? <div style={emptyState}>Loading essays…</div> : filteredDrafts.length === 0 ? <div style={emptyState}>No matching essays yet.</div> : filteredDrafts.map(draft => (
                    <DraftCard key={draft.id} draft={draft} active={draft.id === activeId} onSelect={() => loadDraft(draft)} onDelete={() => deleteDraft(draft.id)} onShare={(shared) => toggleEssayShare(draft.id, shared)} />
                  ))}
                </div>
                <button onClick={newDraft} style={{ ...btnGhost, width: '100%', justifyContent: 'center', marginTop: 12 }}><i className="fas fa-plus"></i>New essay</button>
              </div>

            </aside>

            <section style={ss({ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 })}>
              <div style={card({ padding: 20 })}>
                <div style={ss({ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 })}>
                  <div>
                    <h2 style={ss({ margin: 0, fontSize: 24, fontWeight: 950, letterSpacing: '-0.35px' })}>{draftTitle(activeDraft, essayType, topicInput)}</h2>
                    {currentCollegeName && <div style={ss({ fontSize: 12, color: 'var(--stone-400)', fontWeight: 700, marginTop: 6 })}>{currentCollegeName}</div>}
                  </div>
                  <button onClick={() => updateDraft(undefined)} style={saveTopButton}><i className="fas fa-save"></i>{activeId ? 'Save' : 'Save new'}</button>
                </div>

                <div style={ss({ display: 'grid', gridTemplateColumns: '176px minmax(0,1fr) 80px', gap: 12, marginBottom: 14 })}>
                  <label style={fieldWrap}><span style={fieldLabel}>Essay type</span><select value={essayType} onChange={e => setField(setEssayType, e.target.value)} style={selectStyle}>{ESSAY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                  <label style={fieldWrap}><span style={fieldLabel}>Target college</span><select value={collegeId ?? ''} onChange={e => setField(setCollegeId, e.target.value ? parseInt(e.target.value, 10) : null)} style={selectStyle}><option value="">No college target</option>{userColleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label style={fieldWrap}><span style={fieldLabel}>Word limit</span><input className="essay-input" type="number" min={50} max={1800} value={wordLimit} onChange={e => updateWordLimit(parseInt(e.target.value, 10))} style={inputStyle} /></label>
                </div>

                <div style={ss({ border: '1px solid var(--border)', borderRadius: 16, background: 'linear-gradient(180deg,#fff,#fcfcfb)', padding: 16, marginBottom: 16 })}>
                  <div style={ss({ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 })}>
                    <div style={eyebrowBlue}>Your prompt</div>
                  </div>
                  <textarea ref={promptRef} className="essay-textarea" value={topicInput} onChange={e => updatePrompt(e.target.value)} placeholder="Paste the Common App or supplemental prompt here…" style={ss({ width: '100%', minHeight: 74, resize: 'vertical', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.8, color: 'var(--stone-700)' })} />
                </div>

                <div style={ss({ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' })}>
                  <div style={ss({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(82px, 1fr))', gap: 6, background: 'var(--stone-50)', borderRadius: 14, padding: 4, width: 288 })}>
                    {([
                      ['draft', 'Draft'], ['fine-tune', 'Fine-tune'], ['review', 'Review'],
                    ] as const).map(([id, label]) => (
                      <button key={id} onClick={() => setEditorTab(id)} style={tabButton(editorTab === id)}>{label}</button>
                    ))}
                  </div>
                  <div style={ss({ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 8 })}>
                    <button onClick={() => updateDraft(activeDraft?.status === 'submitted' ? 'draft' : 'submitted')} style={btnMini}><i className="fas fa-check"></i>{activeDraft?.status === 'submitted' ? 'Move to draft' : 'Mark ready'}</button>
                    <button onClick={shareActiveForReview} title={activeDraft?.shared_with_counselor ? 'Stop sharing this draft with expert reviewers' : 'Share this draft with expert reviewers'} style={shareReviewButton(activeDraft?.shared_with_counselor)}><i className="fas fa-user-check"></i>{activeDraft?.shared_with_counselor ? 'Shared' : 'Share for review'}</button>
                  </div>
                </div>

                {editorTab === 'fine-tune' && (
                  <div style={ss({ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 })}>
                    <div style={ss({ display: 'flex', flexWrap: 'wrap', gap: 8 })}>
                      {FINE_TUNE_ACTIONS.map(action => <button key={action} onClick={() => toggleTune(action)} style={tuneChip(selectedTunes.includes(action))}>{action}</button>)}
                    </div>
                    <div style={ss({ display: 'flex', gap: 10, alignItems: 'stretch' })}>
                      <textarea value={refineInstructions} onChange={e => setRefineInstructions(e.target.value)} placeholder="Optional: tell AI exactly what to improve…" style={ss({ flex: 1, minHeight: 52, border: '1px solid var(--border)', borderRadius: 13, padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit', fontSize: 12, outline: 'none' })} />
                      <button onClick={() => generateWithAI('improve', tuneInstruction())} disabled={aiState === 'generating' || !draftPlainText.trim()} style={{ ...btnPrimary, opacity: aiState === 'generating' || !draftPlainText.trim() ? .55 : 1, minWidth: 150 }}>{aiState === 'generating' && aiMode === 'improve' ? <><i className="fas fa-spinner fa-spin"></i>Refining…</> : <><i className="fas fa-wand-magic-sparkles"></i>Apply fine-tune</>}</button>
                    </div>
                  </div>
                )}

                {editorTab === 'review' && (
                  <ReviewPanel score={scoreResult} hook={hookResult} reader={readerResult} error={scoreError} onReview={runFullReview} loading={scoreLoading || hookLoading || readerLoading} />
                )}

                <div style={ss({ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 14px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--stone-50)', marginBottom: 12, flexWrap: 'wrap' })}>
                  <span style={ss({ fontSize: 12, fontWeight: 800, color: 'var(--stone-500)' })}>Toolbar</span>
                  <button onMouseDown={event => runEditorCommand(event, 'bold')} style={toolbarBtn} title="Bold selected text"><i className="fas fa-bold"></i></button>
                  <button onMouseDown={event => runEditorCommand(event, 'italic')} style={toolbarBtn} title="Italicize selected text"><i className="fas fa-italic"></i></button>
                  <button onClick={exportPdf} style={toolbarBtn}><i className="fas fa-file-pdf"></i></button>
                  <button onClick={exportText} style={toolbarBtn} title="Export TXT"><i className="fas fa-file-lines"></i></button>
                  {editorTab === 'draft' && (
                    <button onClick={() => generateWithAI('generate')} disabled={aiState === 'generating'} style={{ ...btnMini, marginLeft: 'auto', background: 'var(--yellow)', borderColor: '#e7cf00', color: ESSAY_NAVY }}>{aiState === 'generating' && aiMode === 'generate' ? <><i className="fas fa-spinner fa-spin"></i>Generating…</> : <><i className="fas fa-sparkles"></i>Generate draft</>}</button>
                  )}
                </div>

                <div style={ss({ position: 'relative', border: '1px solid var(--border)', borderRadius: 18, background: '#fff', overflow: 'hidden' })}>
                  <div
                    ref={editorRef}
                    className="essay-textarea essay-rich-editor"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={syncEditorState}
                    onPaste={pastePlainText}
                    data-placeholder="Start writing your essay here..."
                    style={ss({ width: '100%', height: 430, maxHeight: 430, overflowY: 'auto', border: 'none', outline: 'none', padding: '24px 26px', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.8, color: 'var(--stone-800)', background: '#fff', whiteSpace: 'pre-wrap' })}
                  />
                  <div style={ss({ borderTop: '1px solid var(--border-light)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', background: '#fff' })}>
                    <div style={ss({ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' })}><span style={ss({ fontSize: 13, fontWeight: 900 })}>{wc} words</span><span style={ss({ fontSize: 13, color: 'var(--stone-500)' })}>Goal: {wordLimit}</span><span style={pill(wordPct > 100 ? '#FEE2E2' : '#ECFDF5', wordPct > 100 ? '#B91C1C' : '#0F6E56')}>{wordPct > 100 ? 'Over limit' : 'On track'}</span></div>
                    <div style={ss({ display: 'flex', alignItems: 'center', gap: 10, minWidth: 240 })}><div style={ss({ flex: 1, height: 8, background: 'var(--stone-100)', borderRadius: 999, overflow: 'hidden' })}><div style={ss({ width: `${Math.min(wordPct, 100)}%`, height: '100%', background: wordPct > 100 ? '#EF4444' : 'linear-gradient(90deg,#004EEB,#6A78FF)' })}></div></div><span style={ss({ fontSize: 13, fontWeight: 900, color: wordPct > 100 ? '#B91C1C' : 'var(--blue)' })}>{wc} / {wordLimit}</span></div>
                  </div>
                </div>
              </div>

            </section>

            <aside className="essay-coach" style={ss({ display: 'flex', flexDirection: 'column', gap: 14 })}>
              <div style={card({ padding: 16 })}>
                <div style={ss({ display: 'flex', gap: 6, background: 'var(--stone-50)', borderRadius: 14, padding: 4, marginBottom: 14 })}>
                  {([
                    ['coach', 'Coach'], ['review', 'Review'], ['inspiration', 'Inspiration'],
                  ] as const).map(([id, label]) => <button key={id} onClick={() => setCoachTab(id)} style={coachTabButton(coachTab === id)}>{label}</button>)}
                </div>

                {coachTab === 'coach' && (
                  <>
                    <div style={card({ padding: 14 })}>
                      <div style={eyebrow}>Inputs</div>
                      <ToggleRow label="My Voice" sub={`${validVoiceSamples} sample${validVoiceSamples === 1 ? '' : 's'}`} checked={useVoice} onChange={() => setUseVoice(v => !v)} />
                      <ToggleRow label="Journey" sub={useJourney ? 'Activities on' : 'Not included'} checked={useJourney} onChange={() => setUseJourney(v => !v)} />
                      {useJourney && (
                        <div style={alertStyle('var(--stone-100)', 'var(--stone-600)')}>
                          <i className="fas fa-shield-halved"></i>
                          Admitly may include relevant profile, activity, and story details in AI requests so suggestions can reflect your background. Turn Journey off to use only this essay draft and prompt.
                        </div>
                      )}
                      <div style={ss({ marginTop: 12 })}><div style={fieldLabel}>Tone</div><div style={ss({ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 7 })}>{TONE_OPTIONS.map(t => <button key={t} onClick={() => toggleTone(t)} style={toneChip(toneChips.includes(t))}>{t}</button>)}</div></div>
                      <div style={ss({ marginTop: 12 })}><div style={fieldLabel}>Formality</div><input type="range" min={1} max={5} value={formality} onChange={e => setField(setFormality, parseInt(e.target.value, 10))} /></div>
                      <div style={ss({ marginTop: 12 })}><div style={fieldLabel}>Narrative focus</div><input type="range" min={1} max={4} value={narrativeFocus} onChange={e => setField(setNarrativeFocus, parseInt(e.target.value, 10))} /></div>
                    </div>

                    {aiError && <div style={alertStyle('#FEF2F2', '#B91C1C')}><i className="fas fa-circle-exclamation"></i>{aiError}</div>}
                    {aiRemaining !== null && aiRemaining <= 5 && <div style={alertStyle('#FFFBEA', '#8a6500')}><i className="fas fa-triangle-exclamation"></i>{aiRemaining} AI generation{aiRemaining === 1 ? '' : 's'} left today.</div>}
                  </>
                )}

                {coachTab === 'review' && (
                  <>
                    <div style={ss({ fontSize: 11, color: 'var(--stone-400)', fontWeight: 900, textTransform: 'uppercase', marginBottom: 10 })}>Expert counselor review</div>
                    <div style={ss({ padding: 14, border: '1px solid var(--border)', borderRadius: 16, background: '#fff', marginBottom: 14 })}>
                      <div style={ss({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 })}>
                        <div style={ss({ fontSize: 13, fontWeight: 900 })}>{activeDraft?.shared_with_counselor ? 'Shared with counselors' : 'Not shared yet'}</div>
                        <span style={pill(activeDraft?.shared_with_counselor ? '#ECFDF5' : 'var(--stone-100)', activeDraft?.shared_with_counselor ? '#0F6E56' : 'var(--stone-500)')}>{activeDraft?.shared_with_counselor ? 'Shared' : 'Private'}</span>
                      </div>
                      {expertStatus?.counselor ? <Reviewer name={expertStatus.counselor.name} role={expertStatus.counselor.title || 'Expert Counselor'} initials={expertStatus.counselor.initials} /> : <div style={ss({ fontSize: 13, color: 'var(--stone-500)', lineHeight: 1.6, padding: '8px 0' })}>No expert counselor is assigned yet. You can still share the draft now; it will be visible when an expert is assigned.</div>}
                      <button onClick={shareActiveForReview} title={activeDraft?.shared_with_counselor ? 'Stop sharing this draft with expert reviewers' : 'Share this draft with expert reviewers'} style={{ ...shareReviewButton(activeDraft?.shared_with_counselor), width: '100%', justifyContent: 'center', marginTop: 12 }}><i className="fas fa-user-check"></i>{activeDraft?.shared_with_counselor ? 'Shared' : 'Share for review'}</button>
                    </div>

                    <div style={ss({ padding: 16, borderRadius: 16, background: '#F7FAFF', border: '1px solid #DDE8FF' })}>
                      <div style={ss({ width: 38, height: 38, borderRadius: 14, background: '#EEF4FF', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 })}><i className="fas fa-graduation-cap"></i></div>
                      <div style={ss({ fontSize: 16, fontWeight: 900, marginBottom: 6 })}>Get expert essay feedback</div>
                      <div style={ss({ fontSize: 13, color: 'var(--stone-600)', lineHeight: 1.65, marginBottom: 12 })}>Book an expert session for personalized guidance on structure, story strength, and admissions impact.</div>
                      <button onClick={() => router.push('/expert-sessions')} style={{ ...btnPrimary, width: '100%', justifyContent: 'center' }}>{expertStatus?.assignment ? 'Open expert sessions' : 'Request expert review'}</button>
                    </div>
                  </>
                )}

                {coachTab === 'inspiration' && (
                  <>
                    <div style={ss({ fontSize: 11, color: 'var(--stone-400)', fontWeight: 900, textTransform: 'uppercase', marginBottom: 10 })}>Writing inspiration</div>
                    <InspirationCard icon="fa-sparkles" title="Strong opening pattern" text="Open with one concrete scene, then widen into the meaning behind it." />
                    <InspirationCard icon="fa-heart" title="Counselor favorite" text="Show the reason behind your actions before listing outcomes." />
                    <InspirationCard icon="fa-wave-square" title="Voice reminder" text="Natural phrasing beats polished but generic language." />
                    <button onClick={() => router.push('/settings#journey')} style={{ ...btnGhost, width: '100%', justifyContent: 'center', marginTop: 8 }}><i className="fas fa-compass"></i>Edit Journey data</button>
                  </>
                )}
              </div>

              {useVoice && (
                <VoicePanel samples={voiceSamples} setSamples={setVoiceSamples} onSave={saveVoiceSamples} saving={voiceSaving} />
              )}

              <div style={ss({ ...card({ padding: 16 }), display: 'flex', flexDirection: 'column', gap: 12 })}>
                <div style={ss({ display: 'flex', alignItems: 'flex-start', gap: 12 })}>
                  <div style={ss({ width: 38, height: 38, borderRadius: 14, background: '#FFF8D7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a6500', flexShrink: 0 })}><i className="fas fa-shield-halved"></i></div>
                  <div><div style={ss({ fontSize: 14, fontWeight: 900 })}>Academic integrity matters</div><div style={ss({ fontSize: 13, color: 'var(--stone-500)', marginTop: 4, lineHeight: 1.6 })}>Use AI tools to brainstorm and refine, but keep the final essay in your own voice.</div></div>
                </div>
                <button onClick={() => router.push('/help')} style={{ ...btnGhost, width: '100%', justifyContent: 'center' }}>Learn more</button>
              </div>
            </aside>
          </section>
        </div>
        {toast && <button onClick={() => setToast('')} style={toastStyle}>{toast}</button>}
      </main>
    </AppShell>
  );
}

function StatCard({ icon, bg, fg, value, label, sub }: { icon: string; bg: string; fg: string; value: string; label: string; sub: string }) {
  return (
    <div style={ss({ ...card({ padding: 18 }), display: 'flex', alignItems: 'center', gap: 14 })}>
      <div style={ss({ width: 46, height: 46, borderRadius: 16, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center' })}><i className={`fas ${icon}`}></i></div>
      <div><div style={statLabel}>{label}</div><div style={ss({ fontSize: 28, fontWeight: 950, lineHeight: 1.1, marginTop: 2 })}>{value}</div><div style={ss({ fontSize: 12, color: 'var(--stone-500)', marginTop: 3 })}>{sub}</div></div>
    </div>
  );
}

function DraftCard({ draft, active, onSelect, onDelete, onShare }: { draft: EssayDraft; active: boolean; onSelect: () => void; onDelete: () => void; onShare: (shared: boolean) => void }) {
  const label = ESSAY_TYPE_LABELS[draft.essay_type] ?? draft.essay_type;
  const pct = Math.min(100, Math.round((draft.word_count / Math.max(1, draft.word_limit || 650)) * 100));
  return (
    <button onClick={onSelect} style={ss({ textAlign: 'left', width: '100%', border: active ? '1.5px solid #9BB7FF' : '1px solid var(--border)', borderRadius: 16, padding: 14, background: active ? '#F7FAFF' : '#fff', cursor: 'pointer', boxShadow: active ? '0 10px 26px rgba(0,78,235,.08)' : 'none', fontFamily: 'inherit' })}>
      <div style={ss({ display: 'flex', justifyContent: 'space-between', gap: 10 })}>
        <div style={ss({ minWidth: 0 })}><div style={ss({ fontSize: 15, fontWeight: 900, color: 'var(--stone-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{label}</div><div style={ss({ fontSize: 12, color: 'var(--stone-500)', marginTop: 4 })}>{draft.college_name ? draft.college_name : 'No college target'}</div></div>
        <div onClick={e => e.stopPropagation()} style={ss({ display: 'flex', gap: 4 })}>
          <button onClick={() => onShare(!draft.shared_with_counselor)} title={draft.shared_with_counselor ? 'Stop sharing with expert reviewers' : 'Share with expert reviewers'} style={tinyIcon(draft.shared_with_counselor ? 'var(--yellow)' : '#fff', ESSAY_NAVY, draft.shared_with_counselor ? '#e7cf00' : 'var(--border)')}><i className="fas fa-user-check"></i></button>
          <button onClick={onDelete} title="Delete" style={tinyIcon('#fff', 'var(--stone-400)')}><i className="fas fa-trash"></i></button>
        </div>
      </div>
      <div style={ss({ marginTop: 10, height: 6, background: 'var(--stone-100)', borderRadius: 999, overflow: 'hidden' })}><div style={ss({ width: `${pct}%`, height: '100%', background: pct > 95 ? '#F59E0B' : '#004EEB' })}></div></div>
      <div style={ss({ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 10 })}>
        <div style={ss({ display: 'flex', gap: 8, flexWrap: 'wrap' })}><span style={pill(draft.status === 'submitted' ? '#EAF7EE' : '#EEF4FF', draft.status === 'submitted' ? '#0F6E56' : '#004EEB')}>{draft.status === 'submitted' ? 'Ready' : 'Draft'}</span>{draft.expert_tag && <span style={pill('#F5F3FF', '#5B43D6')}>Expert Essay</span>}</div>
        <span style={ss({ fontSize: 11, color: 'var(--stone-400)', fontWeight: 800 })}>{timeAgo(draft.updated_at)}</span>
      </div>
    </button>
  );
}

function ToggleRow({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: () => void }) {
  return (
    <div style={ss({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border-light)' })}>
      <div><div style={ss({ fontSize: 13, fontWeight: 900 })}>{label}</div><div style={ss({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>{sub}</div></div>
      <button onClick={onChange} style={ss({ width: 42, height: 24, borderRadius: 999, border: 'none', background: checked ? ESSAY_NAVY : 'var(--stone-200)', position: 'relative', cursor: 'pointer' })}><span style={ss({ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 18, height: 18, borderRadius: 999, background: '#fff', transition: 'left .15s' })}></span></button>
    </div>
  );
}

function Reviewer({ name, role, initials }: { name: string; role: string; initials: string }) {
  return <div style={ss({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-light)' })}><span style={ss({ width: 38, height: 38, borderRadius: 14, background: '#FFF8D7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#8a6500' })}>{initials}</span><div><div style={ss({ fontSize: 13, fontWeight: 900 })}>{name}</div><div style={ss({ fontSize: 12, color: 'var(--stone-500)' })}>{role}</div></div></div>;
}

function InspirationCard({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div style={ss({ padding: 14, border: '1px solid var(--border)', borderRadius: 16, background: '#fff', marginBottom: 10 })}><div style={ss({ display: 'flex', gap: 10 })}><div style={ss({ width: 34, height: 34, borderRadius: 12, background: '#FFF8D7', color: '#8a6500', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}><i className={`fas ${icon}`}></i></div><div><div style={ss({ fontSize: 14, fontWeight: 900 })}>{title}</div><div style={ss({ fontSize: 13, color: 'var(--stone-600)', lineHeight: 1.6, marginTop: 4 })}>{text}</div></div></div></div>;
}

function ReviewPanel({ score, hook, reader, error, onReview, loading }: { score: ScoreResult | null; hook: HookResult | null; reader: ReaderResult | null; error: string; onReview: () => void; loading: boolean }) {
  return (
    <div style={ss({ border: '1px solid #DDE8FF', background: '#F7FAFF', borderRadius: 16, padding: 14, marginBottom: 12 })}>
      <div style={ss({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 })}>
        <div><div style={eyebrowBlue}>Review workspace</div><div style={ss({ fontSize: 14, fontWeight: 900, marginTop: 3 })}>AI scoring, hook analysis, and reader simulation</div></div>
        <button onClick={onReview} disabled={loading} style={btnMini}>{loading ? <><i className="fas fa-spinner fa-spin"></i>Reviewing…</> : <><i className="fas fa-magnifying-glass-chart"></i>Run full review</>}</button>
      </div>
      {error && <div style={alertStyle('#FEF2F2', '#B91C1C')}><i className="fas fa-circle-exclamation"></i>{error}</div>}
      <div style={ss({ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 })}>
        <ReviewMini title="Overall" value={score?.overall_score ? `${score.overall_score}/100` : '—'} text={score?.overall_verdict || 'Run AI review for a full admissions-style score.'} />
        <ReviewMini title="Hook" value={hook?.overall_score ? `${hook.overall_score}/100` : '—'} text={hook?.one_line_verdict || hook?.rewrite_suggestion || 'Analyze the opening for intrigue, clarity, and originality.'} />
        <ReviewMini title="Reader" value={reader?.overall_score ? `${reader.overall_score}/100` : '—'} text={reader?.verdict_sentence || reader?.first_impression || 'Simulate how an admissions reader reacts.'} />
      </div>
      {(score?.top_3_improvements?.length || reader?.key_concerns?.length) ? (
        <div style={ss({ marginTop: 12, padding: 12, borderRadius: 13, background: '#fff', border: '1px solid var(--border)' })}>
          <div style={ss({ fontSize: 12, fontWeight: 900, marginBottom: 8 })}>Recommended next edits</div>
          <ul style={ss({ margin: 0, paddingLeft: 18, color: 'var(--stone-600)', fontSize: 12, lineHeight: 1.6 })}>{(score?.top_3_improvements || reader?.key_concerns || []).slice(0, 3).map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

function ReviewMini({ title, value, text }: { title: string; value: string; text: string }) {
  return <div style={ss({ padding: 12, borderRadius: 13, background: '#fff', border: '1px solid var(--border)' })}><div style={ss({ fontSize: 11, color: 'var(--stone-400)', fontWeight: 900, textTransform: 'uppercase' })}>{title}</div><div style={ss({ fontSize: 22, fontWeight: 950, marginTop: 5 })}>{value}</div><div style={ss({ fontSize: 12, color: 'var(--stone-500)', lineHeight: 1.55, marginTop: 5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' })}>{text}</div></div>;
}

function VoicePanel({ samples, setSamples, onSave, saving }: { samples: string[]; setSamples: React.Dispatch<React.SetStateAction<string[]>>; onSave: () => void; saving: boolean }) {
  return (
    <div style={card({ padding: 16, background: 'var(--yellow)', borderColor: '#E7CF00', boxShadow: '0 12px 30px rgba(231,207,0,.14)' })}>
      <div style={ss({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 })}>
        <div><div style={{ ...eyebrow, color: ESSAY_NAVY }}>My writing voice</div><div style={ss({ fontSize: 16, fontWeight: 900, marginTop: 3, color: ESSAY_NAVY })}>Train Admitly on your style</div></div>
        <button onClick={onSave} disabled={saving} style={btnMini}>{saving ? <><i className="fas fa-spinner fa-spin"></i>Saving…</> : <><i className="fas fa-save"></i>Save</>}</button>
      </div>
      <div style={ss({ fontSize: 12, lineHeight: 1.6, color: ESSAY_NAVY, marginBottom: 12, fontWeight: 750 })}>Paste up to five of your own past essays or personal writing samples. Admitly uses them only to better reflect your natural style and make new drafts feel more personal.</div>
      <div style={ss({ display: 'flex', flexDirection: 'column', gap: 10 })}>
        {samples.map((sample, idx) => {
          const wc = wordCount(sample);
          const ok = wc >= VOICE_WORD_MIN && wc <= VOICE_WORD_MAX;
          return (
            <div key={idx} style={ss({ border: `1px solid ${ok ? '#A7F3D0' : 'var(--border)'}`, borderRadius: 14, overflow: 'hidden', background: '#fff' })}>
              <div style={ss({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: ok ? '#ECFDF5' : 'var(--stone-50)' })}><span style={ss({ fontSize: 12, fontWeight: 900 })}>Sample {idx + 1}</span><span style={ss({ fontSize: 11, color: ok ? '#0F6E56' : 'var(--stone-400)', fontWeight: 800 })}>{wc} words</span></div>
              <textarea value={sample} onChange={e => { const next = [...samples]; next[idx] = e.target.value; setSamples(next); }} placeholder="Paste a real essay, class reflection, or personal writing sample…" style={ss({ width: '100%', minHeight: 86, border: 'none', outline: 'none', resize: 'vertical', padding: 10, fontFamily: 'inherit', fontSize: 12, lineHeight: 1.55 })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const card = (extra: React.CSSProperties = {}): React.CSSProperties => ({ background: '#fff', border: '1px solid var(--border)', borderRadius: 22, boxShadow: '0 1px 0 rgba(28,25,23,.03)', ...extra });
const btnBase: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, padding: '12px 16px', fontSize: 13, fontWeight: 900, border: '1px solid var(--border)', fontFamily: 'inherit', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { ...btnBase, background: '#fff', color: 'var(--stone-700)' };
const btnPrimary: React.CSSProperties = { ...btnBase, background: 'var(--yellow)', border: '1px solid #e7cf00', color: ESSAY_NAVY };
const btnMini: React.CSSProperties = { ...btnBase, padding: '8px 12px', borderRadius: 12, fontSize: 12, background: '#fff', color: 'var(--stone-700)' };
const saveTopButton: React.CSSProperties = { ...btnMini, background: ESSAY_NAVY, border: `1px solid ${ESSAY_NAVY}`, color: '#fff', minWidth: 112 };
const iconBtn: React.CSSProperties = { ...btnBase, width: 42, height: 42, padding: 0, background: '#fff', color: 'var(--stone-700)' };
const toolbarBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: 'var(--stone-600)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const statLabel: React.CSSProperties = { fontSize: 12, color: 'var(--stone-400)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.25px' };
const eyebrow: React.CSSProperties = { fontSize: 11, color: 'var(--stone-400)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.45px' };
const eyebrowBlue: React.CSSProperties = { ...eyebrow, color: 'var(--blue)' };
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };
const fieldLabel: React.CSSProperties = { fontSize: 11, color: 'var(--stone-400)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.35px' };
const inputStyle: React.CSSProperties = { height: 42, border: '1px solid var(--border)', borderRadius: 12, padding: '0 12px', outline: 'none', background: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--stone-800)' };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'none' as any };
const emptyState: React.CSSProperties = { padding: 22, textAlign: 'center', color: 'var(--stone-400)', fontSize: 13, border: '1px dashed var(--border)', borderRadius: 16, background: 'var(--stone-50)' };
const toastStyle: React.CSSProperties = { position: 'fixed', right: 24, bottom: 24, border: 'none', borderRadius: 16, background: ESSAY_NAVY, color: '#fff', padding: '12px 16px', boxShadow: '0 16px 40px rgba(0,0,0,.18)', fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer', zIndex: 60 };

function pill(bg: string, fg: string): React.CSSProperties { return { display: 'inline-flex', gap: 6, alignItems: 'center', background: bg, color: fg, borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 900, border: bg === '#fff' ? '1px solid var(--border)' : 'none' }; }
function filterPill(active: boolean): React.CSSProperties { return { ...pill(active ? ESSAY_NAVY : 'var(--stone-100)', active ? '#fff' : 'var(--stone-600)'), border: 'none', cursor: 'pointer', fontFamily: 'inherit' }; }
function tabButton(active: boolean): React.CSSProperties { return { ...coachTabButton(active), minWidth: 0 }; }
function coachTabButton(active: boolean): React.CSSProperties { return { flex: 1, border: 'none', borderRadius: 10, padding: '9px 8px', background: active ? ESSAY_NAVY : 'transparent', boxShadow: active ? '0 1px 2px rgba(0,0,0,.05)' : 'none', color: active ? '#fff' : 'var(--stone-500)', fontSize: 12, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }; }
function tuneChip(active: boolean): React.CSSProperties { return { ...toneChip(active), padding: '8px 11px', fontSize: 12 }; }
function toneChip(active: boolean): React.CSSProperties { return { padding: '7px 10px', borderRadius: 999, border: active ? `1px solid ${ESSAY_NAVY}` : '1px solid var(--border)', background: active ? ESSAY_NAVY : '#fff', color: active ? '#fff' : 'var(--stone-600)', fontSize: 11, fontWeight: 850, cursor: 'pointer', fontFamily: 'inherit' }; }
function shareReviewButton(shared?: boolean | null): React.CSSProperties {
  return {
    ...btnMini,
    background: shared ? 'var(--yellow)' : '#fff',
    border: shared ? '1px solid #e7cf00' : '1px solid var(--border)',
    color: ESSAY_NAVY,
  };
}
function tinyIcon(bg: string, fg: string, border = 'var(--border)'): React.CSSProperties { return { width: 28, height: 28, borderRadius: 9, border: `1px solid ${border}`, background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11 }; }
function alertStyle(bg: string, fg: string): React.CSSProperties { return { display: 'flex', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 14, background: bg, color: fg, fontSize: 12, lineHeight: 1.5, fontWeight: 750, marginTop: 12 }; }
