'use client';

import { useState, useRef, useEffect } from 'react';
import { SearchResultWithDraft } from '@/app/actions/search';
import { PersonCard } from './PersonCard';

interface ResultsListProps {
  results: SearchResultWithDraft[];
  onReviewAndSend: () => void;
  onExpand: (index: number) => void;
  onHide?: (userCandidateId: string) => void;
  isSending: boolean;
  sendingIndex?: number;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
  remainingDaily: number;
}

export function ResultsList({
  results,
  onReviewAndSend,
  onExpand,
  onHide,
  isSending,
  sendingIndex,
  sendStatuses,
  remainingDaily,
}: ResultsListProps) {
  const [linkedinDropdownOpen, setLinkedinDropdownOpen] = useState(false);
  const [openedLinkedins, setOpenedLinkedins] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);

  const sendableCount = results.filter(
    (r) => r.email && !sendStatuses.has(r.id)
  ).length;

  const peopleWithLinkedin = results.filter((r) => r.linkedinUrl);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setLinkedinDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenLinkedin = (url: string, personId: string) => {
    // Open in background tab by simulating Ctrl+click
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);

    // Dispatch click with ctrlKey to open in background
    const event = new MouseEvent('click', {
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
      view: window,
    });
    link.dispatchEvent(event);
    document.body.removeChild(link);

    setOpenedLinkedins((prev) => new Set(prev).add(personId));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
              {results.length} Results Found
            </h2>
            {/* LinkedIn Dropdown */}
            {peopleWithLinkedin.length > 0 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setLinkedinDropdownOpen(!linkedinDropdownOpen)}
                  className="p-1.5 text-[#0A66C2] hover:bg-blue-50 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </button>

                {linkedinDropdownOpen && (
                  <div className="absolute left-0 mt-2 w-64 max-h-80 overflow-y-auto bg-white rounded-md shadow-lg border border-gray-200 z-50">
                    <div className="py-1">
                      {peopleWithLinkedin.map((person) => (
                        <button
                          key={person.id}
                          onClick={() => handleOpenLinkedin(person.linkedinUrl!, person.id)}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{person.fullName}</span>
                          {openedLinkedins.has(person.id) ? (
                            <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="text-sm text-gray-500">
            {remainingDaily} emails remaining today
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onReviewAndSend}
            disabled={sendableCount === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send All ({sendableCount})
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {results.map((person, index) => (
          <PersonCard
            key={person.id}
            person={person}
            onExpand={() => onExpand(index)}
            onHide={person.userCandidateId && onHide ? () => onHide(person.userCandidateId!) : undefined}
            isSending={isSending && sendingIndex === index}
            sendStatus={sendStatuses.get(person.id)}
          />
        ))}
      </div>
    </div>
  );
}
