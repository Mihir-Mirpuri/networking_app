'use client';

import { SearchResultWithDraft } from '@/app/actions/search';
import { PersonCard } from './PersonCard';

interface ResultsListProps {
  results: SearchResultWithDraft[];
  onSendAll: () => void;
  onSendSingle: (index: number) => void;
  onExpand: (index: number) => void;
  isSending: boolean;
  sendingIndex?: number;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
  remainingDaily: number;
  generatingStatuses: Map<string, boolean>;
}

export function ResultsList({
  results,
  onSendAll,
  onSendSingle,
  onExpand,
  isSending,
  sendingIndex,
  sendStatuses,
  remainingDaily,
  generatingStatuses,
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
          onClick={onSendAll}
          disabled={isSending || sendableCount === 0}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSending ? 'Sending...' : `Send All (${sendableCount})`}
        </button>
      </div>

      <div className="space-y-3">
        {results.map((person, index) => (
          <PersonCard
            key={person.id}
            person={person}
            onSend={() => onSendSingle(index)}
            onExpand={() => onExpand(index)}
            isSending={isSending && sendingIndex === index}
            sendStatus={sendStatuses.get(person.id)}
            isGenerating={person.userCandidateId ? generatingStatuses.get(person.userCandidateId) || false : false}
          />
        ))}
      </div>
    </div>
  );
}
