'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { researchCompanyAction } from '@/app/actions/research';
import { TalkingPoint } from '@/lib/services/company-research';
import { LoadingDots } from '@/components/search/LoadingSpinner';

interface CompanyResearchPanelProps {
  company: string;
  role?: string | null;
  personName?: string;
  body: string;
  onUseTalkingPoint: (point: string) => void;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

export function CompanyResearchPanel({
  company,
  role,
  personName,
  body,
  onUseTalkingPoint,
}: CompanyResearchPanelProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [talkingPoints, setTalkingPoints] = useState<TalkingPoint[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef(false);

  const doResearch = useCallback(async (companyName: string) => {
    abortRef.current = false;
    setStatus('loading');
    setErrorMsg('');
    setTalkingPoints([]);

    const result = await researchCompanyAction({
      company: companyName,
      role: role || undefined,
      personName,
    });

    if (abortRef.current) return;

    if (result.success && result.research.talkingPoints.length > 0) {
      setTalkingPoints(result.research.talkingPoints);
      setStatus('success');
    } else if (result.success) {
      setErrorMsg(`No recent info found for ${companyName}.`);
      setStatus('error');
    } else {
      setErrorMsg(result.error || 'Research failed');
      setStatus('error');
    }
  }, [role, personName]);

  // Auto-trigger with debounce when company changes
  useEffect(() => {
    if (!company?.trim()) {
      setStatus('idle');
      setTalkingPoints([]);
      return;
    }

    abortRef.current = true; // cancel any in-flight request
    const timer = setTimeout(() => {
      doResearch(company.trim());
    }, 500);

    return () => {
      clearTimeout(timer);
      abortRef.current = true;
    };
  }, [company, doResearch]);

  const isPointUsed = (point: string) =>
    body.toLowerCase().includes(point.toLowerCase());

  if (status === 'idle') return null;

  if (status === 'loading') {
    return (
      <div className="mb-4 p-3 bg-primary-50 border border-primary-100 rounded-lg">
        <div className="flex items-center gap-2 text-sm text-primary-600">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>Researching {company}</span>
          <LoadingDots className="text-primary-400" />
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mb-4 p-3 bg-surface-50 border border-surface-200 rounded-lg">
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-500">{errorMsg}</p>
          <button
            type="button"
            onClick={() => doResearch(company.trim())}
            className="text-xs text-primary-600 hover:text-primary-800 font-medium"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 p-3 bg-primary-50 border border-primary-100 rounded-lg">
      <h4 className="text-sm font-medium text-primary-900 flex items-center gap-1.5 mb-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        About {company}
      </h4>

      <ul className="space-y-2">
        {talkingPoints.map((tp, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="text-primary-300 mt-0.5 flex-shrink-0">&#8226;</span>
            <div className="flex-1 min-w-0">
              <span className="text-surface-700">{tp.point}</span>
              {tp.source && (
                <>
                  {' — '}
                  {tp.sourceUrl ? (
                    <a
                      href={tp.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-500 hover:text-primary-700 text-xs"
                    >
                      {tp.source}
                    </a>
                  ) : (
                    <span className="text-surface-400 text-xs">{tp.source}</span>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => onUseTalkingPoint(tp.point)}
              disabled={isPointUsed(tp.point)}
              className={`flex-shrink-0 px-2 py-0.5 text-xs rounded font-medium transition-colors ${
                isPointUsed(tp.point)
                  ? 'bg-emerald-100 text-emerald-600 cursor-default'
                  : 'bg-primary-100 text-primary-700 hover:bg-primary-200'
              }`}
            >
              {isPointUsed(tp.point) ? 'Added' : 'Use'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
