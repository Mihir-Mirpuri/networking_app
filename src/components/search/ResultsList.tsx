'use client';

import { useState, useRef, useEffect } from 'react';
import { signIn } from 'next-auth/react';
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
  limitReached?: boolean;
  onLimitReached?: () => void;
  isAuthenticated?: boolean;
}

export function ResultsList({
  results,
  onReviewAndSend,
  onExpand,
  onHide,
  isSending,
  sendingIndex,
  sendStatuses,
  limitReached,
  onLimitReached,
  isAuthenticated = true,
}: ResultsListProps) {
  const [linkedinDropdownOpen, setLinkedinDropdownOpen] = useState(false);
  const [openedLinkedins, setOpenedLinkedins] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);

  const sendableCount = results.filter(
    (r) => !sendStatuses.has(r.id)
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
      {/* Send All button hidden for now */}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {results.map((person, index) => (
          <div
            key={person.id}
            className="animate-fade-in-up"
            style={{ animationDelay: `${Math.min(index * 75, 600)}ms` }}
          >
            <PersonCard
              person={person}
              onExpand={() => {
                if (!isAuthenticated) {
                  signIn('google', { callbackUrl: '/' });
                  return;
                }
                onExpand(index);
              }}
              onHide={person.userCandidateId && onHide ? () => onHide(person.userCandidateId!) : undefined}
              isSending={isSending && sendingIndex === index}
              sendStatus={sendStatuses.get(person.id)}
              limitReached={limitReached}
              onLimitReached={onLimitReached}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
