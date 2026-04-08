'use client';

import { useState, useRef, useCallback } from 'react';
import {
  testFilterExtraction,
  PlaygroundMessage,
  PlaygroundFilters,
  PlaygroundResult,
  ModelResult,
  ModelChoice,
} from './action';

// ─── ID mappings ────────────────────────────────────────────────────────────

const SENIORITY_MAP: Record<string, string> = {
  '100': 'In Training', '110': 'Entry Level', '120': 'Senior', '130': 'Strategic',
  '200': 'Entry Mgr', '210': 'Exp Mgr', '220': 'Director', '300': 'VP', '310': 'CXO', '320': 'Owner',
};
const FUNCTION_MAP: Record<string, string> = {
  '1': 'Accounting', '2': 'Admin', '3': 'Arts/Design', '4': 'BizDev', '5': 'Community',
  '6': 'Consulting', '7': 'Education', '8': 'Engineering', '9': 'Entrepreneurship',
  '10': 'Finance', '11': 'Healthcare', '12': 'HR', '13': 'IT', '14': 'Legal',
  '15': 'Marketing', '16': 'Media', '17': 'Military', '18': 'Operations',
  '19': 'Product Mgmt', '20': 'Program Mgmt', '21': 'Purchasing', '22': 'QA',
  '23': 'Real Estate', '24': 'Research', '25': 'Sales', '26': 'Customer Success',
};
const INDUSTRY_MAP: Record<string, string> = {
  '4': 'Software Dev', '6': 'IT Consulting', '14': 'Education', '41': 'VC/PE',
  '43': 'Financial Services', '44': 'Banking', '46': 'Investment Banking',
  '47': 'Investment Mgmt', '96': 'Tech/Internet', '133': 'Healthcare',
  '135': 'Pharma', '137': 'Biotech', '143': 'Legal', '147': 'Advertising',
};
const HEADCOUNT_MAP: Record<string, string> = {
  'A': 'Self-employed', 'B': '1-10', 'C': '11-50', 'D': '51-200',
  'E': '201-500', 'F': '501-1K', 'G': '1K-5K', 'H': '5K-10K', 'I': '10K+',
};
const YOE_MAP: Record<string, string> = {
  '1': '<1yr', '2': '1-2yr', '3': '3-5yr', '4': '6-10yr', '5': '10+yr',
};

function resolveIds(ids: string[], map: Record<string, string>): string {
  return ids.map(id => `${map[id] || id} (${id})`).join(', ');
}

function statusColor(status: string): string {
  switch (status) {
    case 'ready': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'needs_selection': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'person_lookup': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'off_topic': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'error': return 'bg-red-500/30 text-red-300 border-red-500/50';
    default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
  }
}

function modelColor(model: string): string {
  if (model.includes('haiku')) return 'text-orange-400';
  return 'text-cyan-400';
}

// ─── Presets ─────────────────────────────────────────────────────────────────

const PRESETS = [
  'PMs at Google in Austin',
  'consultants at Bain',
  'senior SWEs at fintech startups in NYC',
  'consultants at top consulting firms from UT Austin',
  'engineers at FAANG',
  'Find John Smith at Goldman Sachs',
  'people at McKinsey',
  'junior designers at Figma from RISD',
  'VPs at Amazon in Seattle',
  'quants at hedge funds',
  'data scientists at Anthropic from MIT',
  'engineers at Ramp',
];

// ─── Filter value display ───────────────────────────────────────────────────

function FilterValue({ filterKey, value }: { filterKey: string; value: unknown }) {
  const arr = Array.isArray(value) ? value as string[] : undefined;
  let display: string;
  if (filterKey === 'seniorityLevelIds' && arr) display = resolveIds(arr, SENIORITY_MAP);
  else if (filterKey === 'functionIds' && arr) display = resolveIds(arr, FUNCTION_MAP);
  else if (filterKey === 'industryIds' && arr) display = resolveIds(arr, INDUSTRY_MAP);
  else if (filterKey === 'companyHeadcount' && arr) display = resolveIds(arr, HEADCOUNT_MAP);
  else if (filterKey === 'yearsOfExperienceIds' && arr) display = resolveIds(arr, YOE_MAP);
  else if (Array.isArray(value)) display = (value as string[]).join(', ');
  else display = String(value);
  return <span className="text-xs text-emerald-400 font-mono break-all">{display}</span>;
}

// ─── Single model result card ───────────────────────────────────────────────

function ModelResultCard({ result, showRaw, onToggleRaw, onSubmit, compact }: {
  result: ModelResult;
  showRaw: boolean;
  onToggleRaw: () => void;
  onSubmit: (q: string) => void;
  compact?: boolean;
}) {
  const { llm, postProcessing, apify } = result;

  if (result.error) {
    return (
      <div className="bg-zinc-900 border border-red-500/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-sm font-semibold ${modelColor(result.model)}`}>{result.modelLabel}</span>
          <span className="text-xs text-red-400">ERROR</span>
          <span className="text-xs text-zinc-600 ml-auto">{result.durationMs}ms</span>
        </div>
        <p className="text-xs text-red-300 font-mono">{result.error}</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/50 bg-zinc-800/20">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${modelColor(result.model)}`}>{result.modelLabel}</span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${statusColor(llm.status)}`}>
            {llm.status}
          </span>
          {llm.confidence && <span className="text-xs text-zinc-500">conf: {llm.confidence}</span>}
          {llm.companyNameAmbiguous && <span className="text-xs text-amber-500">ambiguous</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          <span className="font-semibold text-white">{result.durationMs}ms</span>
          <span>{result.tokenUsage.total} tok</span>
          <button onClick={onToggleRaw} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            {showRaw ? 'Hide' : 'JSON'}
          </button>
        </div>
      </div>

      {/* Assistant message */}
      <div className="px-4 py-2 border-b border-zinc-800/50">
        <p className="text-sm text-zinc-300">{llm.message}</p>
      </div>

      {/* Stage 1: Parsed Filters + LLM linkedin_filters */}
      <div className="border-b border-zinc-800/50">
        <div className="px-4 py-1.5 bg-zinc-800/20">
          <span className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider">1. LLM Output</span>
        </div>
        <div className="grid grid-cols-2 gap-px bg-zinc-800/20">
          <div className="bg-zinc-900 p-3">
            <p className="text-[10px] text-zinc-600 uppercase mb-1.5">Parsed Filters</p>
            {(['company', 'role', 'university', 'location'] as const).map(key => (
              <div key={key} className="flex items-center gap-2 py-0.5">
                <span className="text-[11px] text-zinc-600 w-16 font-mono">{key}</span>
                {llm.filters[key] ? (
                  <span className="text-xs text-white font-mono bg-zinc-800 px-1.5 py-0.5 rounded">{llm.filters[key]}</span>
                ) : (
                  <span className="text-[10px] text-zinc-700">null</span>
                )}
              </div>
            ))}
          </div>
          <div className="bg-zinc-900 p-3">
            <p className="text-[10px] text-zinc-600 uppercase mb-1.5">linkedin_filters (raw)</p>
            {Object.keys(llm.linkedinFilters).length === 0 ? (
              <p className="text-[10px] text-zinc-700 italic">empty</p>
            ) : (
              Object.entries(llm.linkedinFilters).filter(([, v]) => v !== null && v !== undefined).map(([key, val]) => (
                <div key={key} className="flex items-start gap-2 py-0.5">
                  <span className="text-[11px] text-purple-400/70 font-mono shrink-0" style={{ minWidth: '120px' }}>{key}</span>
                  <FilterValue filterKey={key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())} value={val} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Stage 2: Post-Processing */}
      <div className="border-b border-zinc-800/50">
        <div className="px-4 py-1.5 bg-zinc-800/20">
          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">2. Post-Processing</span>
        </div>
        <div className="px-4 py-2 space-y-1.5">
          {postProcessing.steps.map((step, j) => (
            <div key={j} className="flex items-start gap-1.5">
              <span className={`mt-0.5 w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] shrink-0 ${
                step.applied ? 'bg-green-500/20 text-green-400' : 'bg-zinc-800 text-zinc-600'
              }`}>
                {step.applied ? '\u2713' : '-'}
              </span>
              <div className="min-w-0">
                <span className="text-[11px] text-zinc-400">{step.label}</span>
                {step.detail && (
                  <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{step.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stage 3: Final Apify params */}
      <div className={`${!compact ? 'border-b border-zinc-800/50' : ''}`}>
        <div className="px-4 py-1.5 bg-zinc-800/20">
          <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">3. Final API Params → LinkedIn</span>
        </div>
        <div className="px-4 py-2">
          {llm.status !== 'ready' ? (
            <p className="text-[10px] text-zinc-600 italic">No API call — status is &quot;{llm.status}&quot;</p>
          ) : (
            <div className="bg-zinc-950 rounded-lg p-2.5 border border-zinc-800">
              {Object.entries(apify.actorInput)
                .filter(([k]) => !['profileScraperMode', 'startPage', 'takePages'].includes(k))
                .map(([key, val]) => (
                  <div key={key} className="flex items-start gap-2 py-0.5">
                    <span className="text-[11px] text-emerald-500 font-mono shrink-0 w-40">{key}</span>
                    <FilterValue filterKey={key} value={val} />
                  </div>
                ))}
              {Object.entries(apify.actorInput).filter(([k]) => !['profileScraperMode', 'startPage', 'takePages'].includes(k)).length === 0 && (
                <p className="text-[10px] text-zinc-700 italic">No active filters</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Selectables */}
      {llm.selectables && llm.selectables.length > 0 && (
        <div className="border-t border-zinc-800/50 px-4 py-2">
          <div className="flex flex-wrap gap-1.5">
            {llm.selectables.map((s, j) => (
              <button key={j} onClick={() => onSubmit(s.filter_value)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-colors">
                <span className="text-zinc-500 mr-1">{s.filter_key}:</span>{s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Suggested searches */}
      {llm.suggestedSearches && llm.suggestedSearches.length > 0 && (
        <div className="border-t border-zinc-800/50 px-4 py-2">
          <div className="flex flex-wrap gap-1.5">
            {llm.suggestedSearches.map((s, j) => (
              <button key={j} onClick={() => onSubmit(s.label)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Person lookup */}
      {llm.status === 'person_lookup' && (
        <div className="border-t border-zinc-800/50 px-4 py-2">
          <span className="text-xs text-white font-mono">{llm.personName}</span>
          {llm.personCompany && <span className="text-xs text-zinc-400 ml-2">at {llm.personCompany}</span>}
        </div>
      )}

      {/* Raw JSON */}
      {showRaw && (
        <div className="border-t border-zinc-800/50 px-4 py-2">
          <pre className="text-[10px] text-zinc-400 font-mono overflow-x-auto whitespace-pre-wrap bg-zinc-950 rounded-lg p-2 border border-zinc-800 max-h-64 overflow-y-auto">
            {JSON.stringify(llm.raw, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

interface HistoryEntry {
  query: string;
  result: PlaygroundResult;
}

export default function FilterPlayground() {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [conversationHistory, setConversationHistory] = useState<PlaygroundMessage[]>([]);
  const [currentFilters, setCurrentFilters] = useState<PlaygroundFilters>({});
  const [loading, setLoading] = useState(false);
  const [modelChoice, setModelChoice] = useState<ModelChoice>('both');
  const [showRawJson, setShowRawJson] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(async (query?: string) => {
    const message = query || input.trim();
    if (!message || loading) return;

    setInput('');
    setLoading(true);

    try {
      const result = await testFilterExtraction(message, conversationHistory, currentFilters, modelChoice);

      // Use the first result's message/filters for conversation state
      const firstResult = result.results[0];
      if (firstResult && !firstResult.error) {
        const newConvHistory: PlaygroundMessage[] = [
          ...conversationHistory,
          { role: 'user', content: message },
          { role: 'assistant', content: firstResult.llm.message },
        ];
        setConversationHistory(newConvHistory);

        const newFilters: PlaygroundFilters = {};
        if (firstResult.llm.filters.company) newFilters.company = firstResult.llm.filters.company;
        if (firstResult.llm.filters.role) newFilters.role = firstResult.llm.filters.role;
        if (firstResult.llm.filters.university) newFilters.university = firstResult.llm.filters.university;
        if (firstResult.llm.filters.location) newFilters.location = firstResult.llm.filters.location;
        setCurrentFilters(newFilters);
      }

      setHistory(prev => [...prev, { query: message, result }]);

      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    } catch (err) {
      console.error('Filter extraction failed:', err);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, conversationHistory, currentFilters, modelChoice]);

  const handleReset = () => {
    setHistory([]);
    setConversationHistory([]);
    setCurrentFilters({});
    setShowRawJson({});
    setInput('');
    inputRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Filter Extraction Playground</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Full pipeline: LLM → Post-processing → Final Apify API params
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Model toggle */}
            <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
              {(['both', 'groq', 'haiku'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setModelChoice(m)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    modelChoice === m
                      ? 'bg-zinc-700 text-white'
                      : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {m === 'both' ? 'Both (compare)' : m === 'groq' ? 'Groq only' : 'Haiku only'}
                </button>
              ))}
            </div>

            {/* Active filters */}
            {Object.keys(currentFilters).length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {Object.entries(currentFilters).map(([key, value]) => (
                  <span key={key} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                    {key}: {value}
                  </span>
                ))}
              </div>
            )}

            <button onClick={handleReset}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors shrink-0">
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto flex flex-col" style={{ height: 'calc(100vh - 65px)' }}>
        {/* Presets */}
        {history.length === 0 && (
          <div className="px-6 pt-6 pb-2">
            <p className="text-xs text-zinc-600 mb-2">Try a preset:</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button key={preset} onClick={() => handleSubmit(preset)}
                  className="text-xs px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200 transition-colors">
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {history.map((entry, i) => {
            const isSideBySide = entry.result.results.length > 1;

            return (
              <div key={i} className="space-y-3">
                {/* User query */}
                <div className="flex justify-end">
                  <div className="bg-blue-600/20 border border-blue-500/20 rounded-lg px-4 py-2 max-w-md">
                    <p className="text-sm text-blue-200">{entry.query}</p>
                  </div>
                </div>

                {/* Speed comparison bar (when both) */}
                {isSideBySide && (
                  <div className="flex items-center gap-3 px-2">
                    {entry.result.results.map((r, j) => {
                      const fastest = Math.min(...entry.result.results.map(x => x.durationMs));
                      const isFastest = r.durationMs === fastest;
                      return (
                        <div key={j} className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${modelColor(r.model)}`}>{r.modelLabel}</span>
                          <span className={`text-sm font-mono font-bold ${isFastest ? 'text-green-400' : 'text-zinc-400'}`}>
                            {r.durationMs}ms
                          </span>
                          {isFastest && entry.result.results.length > 1 && (
                            <span className="text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">
                              {Math.round(((Math.max(...entry.result.results.map(x => x.durationMs)) / r.durationMs) - 1) * 100)}% faster
                            </span>
                          )}
                          <span className="text-[10px] text-zinc-600">{r.tokenUsage.total} tok</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Model result cards */}
                <div className={isSideBySide ? 'grid grid-cols-2 gap-3' : ''}>
                  {entry.result.results.map((r, j) => (
                    <ModelResultCard
                      key={j}
                      result={r}
                      showRaw={!!showRawJson[`${i}-${j}`]}
                      onToggleRaw={() => setShowRawJson(prev => ({ ...prev, [`${i}-${j}`]: !prev[`${i}-${j}`] }))}
                      onSubmit={handleSubmit}
                      compact={isSideBySide}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex justify-center py-4">
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                {modelChoice === 'both' ? 'Running both models in parallel...' : `Running ${modelChoice}...`}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-zinc-800 px-6 py-3">
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a search query... (e.g., 'senior PMs at fintech startups in SF')"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
              autoFocus
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-sm font-medium text-white transition-colors"
            >
              Test
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
