'use client';

import { SearchResultWithDraft } from '@/app/actions/search';
import { EnvelopeIcon, AcademicCapIcon, MapPinIcon, BuildingOfficeIcon } from '@heroicons/react/24/outline';

interface PersonCardProps {
  person: SearchResultWithDraft;
  onExpand: () => void;
  onHide?: () => void;
  isSending: boolean;
  sendStatus?: 'success' | 'failed' | 'pending';
  scheduledFor?: Date | null;
}

export function PersonCard({
  person,
  onExpand,
  onHide,
  isSending,
  sendStatus,
  scheduledFor,
}: PersonCardProps) {
  const getStatusBadge = () => {
    if (sendStatus === 'success') {
      return (
        <span className="badge-success">
          Sent
        </span>
      );
    }
    if (sendStatus === 'failed') {
      return (
        <span className="badge-error">
          Failed
        </span>
      );
    }
    if (sendStatus === 'pending') {
      return (
        <span className="badge-warning">
          Sending...
        </span>
      );
    }
    return null;
  };

  const getScheduledBadge = () => {
    if (!scheduledFor) return null;
    const scheduledDate = new Date(scheduledFor);
    const now = new Date();
    if (scheduledDate <= now) return null;

    const formattedDate = scheduledDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <span
        className="badge-primary text-xs"
        title={`Scheduled for ${scheduledDate.toLocaleString()}`}
      >
        Scheduled: {formattedDate}
      </span>
    );
  };

  // Generate initials for avatar
  const initials = person.fullName
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="group relative card-hover p-5 flex flex-col items-center text-center">
      {/* Hide button */}
      {onHide && person.userCandidateId && (
        <button
          onClick={onHide}
          className="absolute top-3 right-3 p-1.5 text-surface-400 hover:text-surface-600 hover:bg-surface-100 rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all"
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

      {/* Avatar */}
      <div className="mb-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-md">
          <span className="text-white font-semibold text-lg">{initials}</span>
        </div>
      </div>

      {/* Name and LinkedIn */}
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-semibold text-surface-900 text-base">{person.fullName}</h3>
        {person.linkedinUrl && (
          <a
            href={person.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-6 h-6 text-xs font-semibold text-white bg-[#0A66C2] rounded hover:bg-[#004182] transition-all"
            title="View LinkedIn Profile"
          >
            in
          </a>
        )}
      </div>

      {/* Status badges */}
      {(getStatusBadge() || getScheduledBadge()) && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap justify-center">
          {getStatusBadge()}
          {getScheduledBadge()}
        </div>
      )}

      {/* Role */}
      <p className="text-sm text-primary-600 font-medium mb-4">
        {person.role || 'Professional'}
      </p>

      {/* Info section */}
      <div className="w-full space-y-2 text-left mb-4">
        {/* Company */}
        <div className="flex items-center gap-2">
          <BuildingOfficeIcon className="w-4 h-4 text-surface-400 flex-shrink-0" />
          <p className="text-sm text-surface-700 truncate">{person.company}</p>
        </div>

        {/* University */}
        {person.educationSchool && (
          <div className="flex items-center gap-2">
            <AcademicCapIcon className="w-4 h-4 text-surface-400 flex-shrink-0" />
            <p className="text-sm text-surface-500 truncate">
              {person.educationSchool}
            </p>
          </div>
        )}

        {/* Location */}
        {(person.city || person.state) && (
          <div className="flex items-center gap-2">
            <MapPinIcon className="w-4 h-4 text-surface-400 flex-shrink-0" />
            <p className="text-sm text-surface-500 truncate">
              {[person.city, person.state].filter(Boolean).join(', ')}
            </p>
          </div>
        )}

      </div>

      {/* Action button */}
      <div className="w-full mt-auto">
        <button
          onClick={onExpand}
          className="btn-primary text-sm w-full justify-center"
        >
          <EnvelopeIcon className="w-4 h-4 mr-1.5" />
          Send Email
        </button>
      </div>
    </div>
  );
}
