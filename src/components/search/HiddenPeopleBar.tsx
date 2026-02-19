'use client';

import { useState } from 'react';
import { getHiddenPeopleAction, unhidePersonAction, HiddenPerson } from '@/app/actions/search';

const AVATAR_GRADIENTS = [
  'from-primary-400 to-primary-600',
  'from-teal-400 to-teal-600',
  'from-rose-400 to-rose-600',
  'from-amber-400 to-amber-600',
  'from-violet-400 to-violet-600',
];

function nameToGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

interface HiddenPeopleBarProps {
  hiddenCount: number;
  onCountChange: (delta: number) => void;
}

export function HiddenPeopleBar({ hiddenCount, onCountChange }: HiddenPeopleBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [people, setPeople] = useState<HiddenPerson[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [unhidingIds, setUnhidingIds] = useState<Set<string>>(new Set());

  if (hiddenCount <= 0) return null;

  const handleToggle = async () => {
    const willExpand = !isExpanded;
    setIsExpanded(willExpand);

    if (willExpand) {
      setIsLoading(true);
      const result = await getHiddenPeopleAction();
      if (result.success) {
        setPeople(result.people);
      }
      setIsLoading(false);
    }
  };

  const handleUnhide = async (userCandidateId: string) => {
    setUnhidingIds((prev) => new Set(prev).add(userCandidateId));
    const result = await unhidePersonAction(userCandidateId);

    if (result.success) {
      setPeople((prev) => prev.filter((p) => p.userCandidateId !== userCandidateId));
      onCountChange(-1);
    }
    setUnhidingIds((prev) => {
      const next = new Set(prev);
      next.delete(userCandidateId);
      return next;
    });
  };

  return (
    <div className="mb-4">
      {/* Collapsed bar */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-50 border border-surface-200 rounded-lg text-sm text-surface-500 hover:bg-surface-100 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
          {hiddenCount} {hiddenCount === 1 ? 'person' : 'people'} hidden
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Expanded list */}
      {isExpanded && (
        <div className="mt-2 border border-surface-200 rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-surface-400">
              Loading hidden people...
            </div>
          ) : people.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-sm text-surface-400">
              No hidden people found
            </div>
          ) : (
            <div className="divide-y divide-surface-100 max-h-64 overflow-y-auto">
              {people.map((person) => {
                const initials = person.fullName
                  .split(' ')
                  .map((n) => n[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase();
                const gradient = nameToGradient(person.fullName);
                const isUnhiding = unhidingIds.has(person.userCandidateId);

                return (
                  <div
                    key={person.userCandidateId}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-50 transition-colors"
                  >
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-xs font-medium text-white">{initials}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-800 truncate">{person.fullName}</p>
                      <p className="text-xs text-surface-500 truncate">
                        {person.role ? `${person.role} at ${person.company}` : person.company}
                      </p>
                    </div>

                    {/* Unhide button */}
                    <button
                      onClick={() => handleUnhide(person.userCandidateId)}
                      disabled={isUnhiding}
                      className="flex-shrink-0 px-3 py-1 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors disabled:opacity-50"
                    >
                      {isUnhiding ? 'Unhiding...' : 'Unhide'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
