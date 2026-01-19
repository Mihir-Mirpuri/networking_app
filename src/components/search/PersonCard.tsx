'use client';

import { SearchResultWithDraft } from '@/app/actions/search';

interface PersonCardProps {
  person: SearchResultWithDraft;
  onSend: () => void;
  onExpand: () => void;
  onHide?: () => void;
  isSending: boolean;
  sendStatus?: 'success' | 'failed' | 'pending';
  isGenerating?: boolean;
}

export function PersonCard({
  person,
  onSend,
  onExpand,
  onHide,
  isSending,
  sendStatus,
  isGenerating = false,
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

  const getGeneratingBadge = () => {
    if (isGenerating) {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 animate-pulse">
          Generating email...
        </span>
      );
    }
    return null;
  };

  const getEmailSourceBadge = () => {
    if (!person.email) return null;
    
    if (person.emailSource === 'cache') {
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700 border border-purple-300" title="Email from database cache">
          📦 Cache
        </span>
      );
    }
    if (person.emailSource === 'apollo') {
      return (
        <span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700 border border-orange-300" title="Email from Apollo API">
          📞 Apollo
        </span>
      );
    }
    return null;
  };

  const canSend = person.email && !sendStatus && !isGenerating;

  return (
    <div className="bg-white rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-gray-900">{person.fullName}</h3>
          {getEmailStatusBadge()}
          {getGeneratingBadge()}
          {getStatusBadge()}
        </div>
        <p className="text-sm text-gray-600">
          {person.role ? `${person.role} at ` : ''}
          {person.company}
        </p>
        {person.email ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-blue-600">{person.email}</p>
            {getEmailSourceBadge()}
          </div>
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
        {onHide && person.userCandidateId && (
          <button
            onClick={onHide}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 text-gray-700"
            title="Don't show again"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
