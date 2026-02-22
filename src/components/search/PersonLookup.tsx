'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  MagnifyingGlassIcon,
  UserIcon,
  BuildingOfficeIcon,
  EnvelopeIcon,
  MapPinIcon,
  AcademicCapIcon,
  BriefcaseIcon,
} from '@heroicons/react/24/outline';
import { lookupPersonAction, SearchResultWithDraft, regenerateDraftAction } from '@/app/actions/search';
import { sendSingleEmailAction, PersonToSend } from '@/app/actions/send';
import { getTemplatesAction, TemplateData } from '@/app/actions/profile';
import { ExpandedReview } from './ExpandedReview';
import { Toast } from '@/components/ui/Toast';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';
import { EMAIL_TEMPLATES } from '@/lib/constants';

export function PersonLookup() {
  const { status } = useSession();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResultWithDraft[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Template state
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string>(EMAIL_TEMPLATES[0].id);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // ExpandedReview state
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sendStatuses, setSendStatuses] = useState<Map<string, 'success' | 'failed' | 'pending'>>(new Map());
  const [sendErrors, setSendErrors] = useState<Map<string, string>>(new Map());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitReached, setLimitReached] = useState(false);

  // Load templates on mount
  useEffect(() => {
    if (status !== 'authenticated') return;
    const loadTemplates = async () => {
      const result = await getTemplatesAction();
      const hardcoded = EMAIL_TEMPLATES[0];
      if (result.success) {
        const combined: TemplateData[] = [
          ...result.templates,
          { id: hardcoded.id, name: hardcoded.name, subject: hardcoded.subject, body: hardcoded.body, isDefault: false, attachResume: false, resumeId: null, createdAt: new Date() },
        ];
        setTemplates(combined);
        const defaultT = result.templates.find((t) => t.isDefault);
        setDefaultTemplateId(defaultT?.id || result.templates[0]?.id || hardcoded.id);
      } else {
        setTemplates([{ id: hardcoded.id, name: hardcoded.name, subject: hardcoded.subject, body: hardcoded.body, isDefault: false, attachResume: false, resumeId: null, createdAt: new Date() }]);
        setDefaultTemplateId(hardcoded.id);
      }
    };
    loadTemplates();
  }, [status]);

  const canSearch = name.trim().length >= 2 && !limitReached;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (limitReached) {
      setShowLimitModal(true);
      return;
    }
    if (!canSearch) return;

    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    setResults([]);
    setExpandedIndex(null);
    setSendStatuses(new Map());

    const result = await lookupPersonAction({
      name: name.trim(),
      company: company.trim() || undefined,
    });

    if (result.success) {
      setResults(result.results);
    } else {
      setError(result.error);
    }
    setIsSearching(false);
  };

  const handleSendFromReview = async (index: number, subject: string, body: string): Promise<boolean> => {
    const person = results[index];
    if (!person.userCandidateId) return false;

    setSendStatuses((prev) => new Map(prev).set(person.id, 'pending'));

    const personToSend: PersonToSend = {
      email: person.email || undefined,
      subject,
      body,
      userCandidateId: person.userCandidateId,
      resumeId: person.resumeId ?? undefined,
    };

    const result = await sendSingleEmailAction(personToSend);

    setSendStatuses((prev) =>
      new Map(prev).set(person.id, result.success ? 'success' : 'failed')
    );

    // Update local state with resolved email
    if (result.success && result.email && result.email !== 'unknown') {
      setResults((prev) =>
        prev.map((r) =>
          r.id === person.id ? { ...r, email: result.email } : r
        )
      );
    }

    if (result.success) {
      dispatchCreditsChanged();
      return true;
    } else if (result.error === 'LIMIT_REACHED') {
      setShowLimitModal(true);
      setLimitReached(true);
    } else {
      setSendErrors((prev) => new Map(prev).set(person.id, result.error || 'Failed to send email'));
    }
    return false;
  };

  const handleTemplateChange = async (templateId: string, personIndex: number) => {
    const person = results[personIndex];
    if (!person?.userCandidateId) return;

    setIsRegenerating(true);
    const result = await regenerateDraftAction({
      userCandidateId: person.userCandidateId,
      templateId,
    });

    if (result.success) {
      setResults((prev) =>
        prev.map((r, i) =>
          i === personIndex
            ? { ...r, draftSubject: result.subject, draftBody: result.body, resumeId: result.resumeId }
            : r
        )
      );
    } else {
      setToast({ message: result.error || 'Failed to regenerate draft', type: 'error' });
    }
    setIsRegenerating(false);
  };

  // If ExpandedReview is active, render it
  if (expandedIndex !== null && results.length > 0) {
    return (
      <div className="animate-fade-in">
        <ExpandedReview
          results={results}
          currentIndex={expandedIndex}
          onClose={() => setExpandedIndex(null)}
          onSend={handleSendFromReview}
          sendStatuses={sendStatuses}
          sendErrors={sendErrors}
          templates={templates}
          defaultTemplateId={defaultTemplateId}
          onTemplateChange={handleTemplateChange}
          isRegenerating={isRegenerating}
          limitReached={limitReached}
          onLimitReached={() => setShowLimitModal(true)}
          onDraftGenerated={(idx, subject, body) => {
            setResults((prev) => prev.map((r, i) =>
              i === idx ? { ...r, draftSubject: subject, draftBody: body, llmDraftGenerated: true } : r
            ));
          }}
        />
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <LimitReachedModal
          isOpen={showLimitModal}
          onClose={() => setShowLimitModal(false)}
          onCreditsAwarded={(credits) => {
            setLimitReached(false);
            setToast({ message: `+${credits} email credits added!`, type: 'success' });
            dispatchCreditsChanged();
          }}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Hero section */}
      <div className="card p-8 mb-6">
        <div className="max-w-xl mx-auto text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-50 mb-4">
            <UserIcon className="w-6 h-6 text-primary-600" />
          </div>
          <h2 className="text-xl font-bold text-surface-900 mb-2">
            Look up someone specific
          </h2>
          <p className="text-surface-500 text-sm">
            Already know who you want to reach out to? Enter their name and
            we&apos;ll find their email, company, and other details.
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} className="max-w-lg mx-auto">
          {/* Name input */}
          <div className="relative mb-3">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="w-5 h-5 text-surface-400" />
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name (e.g. Jane Smith)"
              className="w-full pl-12 pr-4 py-3.5 bg-white border-2 border-surface-200 rounded-xl text-surface-900 placeholder:text-surface-400 hover:border-surface-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 focus:outline-none transition-all text-base"
              autoFocus
            />
          </div>

          {/* Company input */}
          <div className="relative mb-3">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <BuildingOfficeIcon className="w-4 h-4 text-surface-400" />
            </div>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company (optional — helps narrow results)"
              className="w-full pl-12 pr-4 py-2.5 bg-surface-50 border border-surface-200 rounded-lg text-surface-800 text-sm placeholder:text-surface-400 hover:border-surface-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/10 focus:outline-none focus:bg-white transition-all"
            />
          </div>

          {/* Search button */}
          <button
            type="submit"
            disabled={(!canSearch || isSearching) && !limitReached}
            className={`btn-primary w-full py-3 text-base${limitReached ? ' opacity-50 cursor-not-allowed' : ''}`}
            onClick={limitReached ? (e) => { e.preventDefault(); setShowLimitModal(true); } : undefined}
          >
            {isSearching ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Looking up...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <MagnifyingGlassIcon className="w-5 h-5" />
                {limitReached ? 'Daily limit reached' : 'Look Up'}
              </span>
            )}
          </button>
        </form>
      </div>

      {/* Results area */}
      {isSearching && <LookupLoadingState name={name} />}

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {!isSearching && !error && hasSearched && results.length === 0 && (
        <EmptyState name={name} company={company} />
      )}

      {!isSearching && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-surface-500 font-medium">
            {results.length} {results.length === 1 ? 'person' : 'people'} found
          </p>
          {results.map((person, index) => (
            <LookupResultCard
              key={person.id}
              person={person}
              sendStatus={sendStatuses.get(person.id)}
              onEmail={limitReached ? () => setShowLimitModal(true) : () => setExpandedIndex(index)}
              limitReached={limitReached}
            />
          ))}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <LimitReachedModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onCreditsAwarded={(credits) => {
          setLimitReached(false);
          setToast({ message: `+${credits} email credits added!`, type: 'success' });
          dispatchCreditsChanged();
        }}
      />
    </div>
  );
}

function LookupLoadingState({ name }: { name: string }) {
  return (
    <div className="card p-8">
      <div className="flex flex-col items-center">
        <div className="relative flex items-center justify-center mb-5" style={{ width: 64, height: 64 }}>
          <div className="absolute w-10 h-10 rounded-full border-2 border-primary-400/30 animate-ripple" />
          <div className="absolute w-10 h-10 rounded-full border-[1.5px] border-primary-300/20 animate-ripple [animation-delay:0.7s]" />
          <div className="relative w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center">
            <MagnifyingGlassIcon className="w-5 h-5 text-primary-600" />
          </div>
        </div>
        <p className="text-surface-800 font-medium mb-1">Looking up {name}...</p>
        <p className="text-sm text-surface-500">Searching profiles and verifying contact info</p>
      </div>

      <div className="mt-6 space-y-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 p-4 rounded-xl bg-surface-50 animate-pulse"
            style={{ animationDelay: `${i * 0.2}s` }}
          >
            <div className="w-12 h-12 rounded-full bg-surface-200 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 bg-surface-200 rounded-md w-40" />
              <div className="h-3 bg-surface-100 rounded-md w-56" />
            </div>
            <div className="h-8 w-24 bg-surface-200 rounded-lg flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ name, company }: { name: string; company: string }) {
  return (
    <div className="card p-8 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-surface-100 mb-4">
        <UserIcon className="w-6 h-6 text-surface-400" />
      </div>
      <p className="text-surface-800 font-medium mb-1">
        No results for &ldquo;{name}&rdquo;{company ? ` at ${company}` : ''}
      </p>
      <p className="text-sm text-surface-500 max-w-sm mx-auto">
        We couldn&apos;t find this person yet. Try checking the spelling or adding
        a company name.
      </p>
    </div>
  );
}

function LookupResultCard({
  person,
  sendStatus,
  onEmail,
  limitReached,
}: {
  person: SearchResultWithDraft;
  sendStatus?: 'success' | 'failed' | 'pending';
  onEmail: () => void;
  limitReached?: boolean;
}) {
  const initials = person.fullName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const emailBadge = () => {
    if (sendStatus === 'success') return <span className="badge-success">Sent</span>;
    return null;
  };

  return (
    <div className="card-hover p-5">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-semibold text-sm">{initials}</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-surface-900 truncate">{person.fullName}</h3>
            {person.linkedinUrl && (
              <a
                href={person.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-semibold text-white bg-[#0A66C2] rounded hover:bg-[#004182] transition-all flex-shrink-0"
                title="View LinkedIn Profile"
              >
                in
              </a>
            )}
            {emailBadge()}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-surface-500">
            {person.role && (
              <span className="flex items-center gap-1">
                <BriefcaseIcon className="w-3.5 h-3.5" />
                {person.role}
              </span>
            )}
            <span className="flex items-center gap-1">
              <BuildingOfficeIcon className="w-3.5 h-3.5" />
              {person.company}
            </span>
            {person.educationSchool && (
              <span className="flex items-center gap-1">
                <AcademicCapIcon className="w-3.5 h-3.5" />
                {person.educationSchool}
              </span>
            )}
            {(person.city || person.state) && (
              <span className="flex items-center gap-1">
                <MapPinIcon className="w-3.5 h-3.5" />
                {[person.city, person.state].filter(Boolean).join(', ')}
              </span>
            )}
          </div>

        </div>

        {/* Action */}
        <div className="flex-shrink-0">
          <button
            onClick={onEmail}
            disabled={sendStatus === 'success' && !limitReached}
            className={
              sendStatus === 'success'
                ? 'btn-secondary text-sm py-2 px-4 opacity-50 cursor-not-allowed'
                : limitReached
                  ? 'btn-primary text-sm py-2 px-4 opacity-50 cursor-not-allowed'
                  : 'btn-primary text-sm py-2 px-4'
            }
          >
            <EnvelopeIcon className="w-4 h-4 mr-1.5" />
            {sendStatus === 'success' ? 'Sent' : limitReached ? 'Limit reached' : 'Email'}
          </button>
        </div>
      </div>
    </div>
  );
}
