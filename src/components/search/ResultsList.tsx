'use client';

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
  const sendableCount = results.filter(
    (r) => r.email && !sendStatuses.has(r.id)
  ).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {results.length} Results Found
          </h2>
          <p className="text-sm text-gray-500">
            {remainingDaily} emails remaining today
          </p>
        </div>
        <button
          onClick={onReviewAndSend}
          disabled={sendableCount === 0}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Review and Send ({sendableCount})
        </button>
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
