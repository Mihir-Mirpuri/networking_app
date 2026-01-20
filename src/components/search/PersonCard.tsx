'use client';

import { SearchResultWithDraft } from '@/app/actions/search';

interface PersonCardProps {
  person: SearchResultWithDraft;
  onExpand: () => void;
  onHide?: () => void;
  isSending: boolean;
  sendStatus?: 'success' | 'failed' | 'pending';
}

export function PersonCard({
  person,
  onExpand,
  onHide,
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

  const canSend = person.email && !sendStatus;

  return (
    <div className="relative bg-white rounded-lg shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      {onHide && person.userCandidateId && (
        <button
          onClick={onHide}
          className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-gray-500"
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}

      <div className="flex-1 pr-6">
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
          <div className="flex items-center gap-2">
            <p className="text-sm text-blue-600">{person.email}</p>
            {getEmailSourceBadge()}
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No email found</p>
        )}
        {person.linkedinUrl && (
          <a
            href={person.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 text-xs font-medium text-white bg-[#0A66C2] rounded hover:bg-[#004182] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
            LinkedIn
          </a>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onExpand}
          className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Send
        </button>
      </div>
    </div>
  );
}
