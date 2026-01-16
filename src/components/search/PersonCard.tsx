'use client';

import { SearchResultWithDraft } from '@/app/actions/search';

interface PersonCardProps {
  person: SearchResultWithDraft;
  onSend: () => void;
  onExpand: () => void;
  isSending: boolean;
  sendStatus?: 'success' | 'failed' | 'pending';
}

export function PersonCard({
  person,
  onSend,
  onExpand,
  isSending,
  sendStatus,
}: PersonCardProps) {
  const getStatusBadge = () => {
    if (sendStatus === 'success') {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
          Sent
        </span>
      );
    }
    if (sendStatus === 'failed') {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
          Failed
        </span>
      );
    }
    if (sendStatus === 'pending') {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">
          Sending...
        </span>
      );
    }
    return null;
  };

  const getEmailStatusBadge = () => {
    if (person.emailStatus === 'VERIFIED') {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
          Verified
        </span>
      );
    }
    if (person.emailStatus === 'UNVERIFIED') {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">
          Unverified
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">
        No Email
      </span>
    );
  };

  const canSend = person.email && !sendStatus;

  return (
    <div className="bg-white rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-gray-900">{person.fullName}</h3>
          {getEmailStatusBadge()}
          {getStatusBadge()}
        </div>
        <p className="text-sm text-gray-600">
          {person.role ? `${person.role} at ` : ''}
          {person.company}
        </p>
        {person.email ? (
          <p className="text-sm text-blue-600">{person.email}</p>
        ) : (
          <p className="text-sm text-gray-400 italic">No email found</p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onExpand}
          className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Review
        </button>
        <button
          onClick={onSend}
          disabled={!canSend || isSending}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSending && sendStatus === 'pending' ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
