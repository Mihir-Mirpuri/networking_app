'use client';

import { SearchResultWithDraft } from '@/app/actions/search';
import { PersonCard } from './PersonCard';

interface ResultsListProps {
  results: SearchResultWithDraft[];
  onExpand: (index: number) => void;
  onHide?: (userCandidateId: string) => void;
  onToggleSaveForLater?: (userCandidateId: string) => void;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
  limitReached?: boolean;
  onLimitReached?: () => void;
}

export function ResultsList({
  results,
  onExpand,
  onHide,
  onToggleSaveForLater,
  sendStatuses,
  limitReached,
  onLimitReached,
}: ResultsListProps) {
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
              onExpand={() => onExpand(index)}
              onHide={person.userCandidateId && onHide ? () => onHide(person.userCandidateId!) : undefined}
              onToggleSaveForLater={person.userCandidateId && onToggleSaveForLater ? () => onToggleSaveForLater(person.userCandidateId!) : undefined}
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
