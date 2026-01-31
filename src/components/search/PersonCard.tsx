'use client';

import { SearchResultWithDraft } from '@/app/actions/search';
import { EnvelopeIcon, AcademicCapIcon, MapPinIcon } from '@heroicons/react/24/outline';

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

  const getEmailStatusBadge = () => {
    if (person.emailStatus === 'VERIFIED') {
      return (
        <span className="badge-success">
          Verified
        </span>
      );
    }
    if (person.emailStatus === 'UNVERIFIED') {
      return (
        <span className="badge-warning">
          Unverified
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-surface-100 text-surface-600">
        No Email
      </span>
    );
  };

  const getScheduledBadge = () => {
    if (!scheduledFor) return null;
    const scheduledDate = new Date(scheduledFor);
    const now = new Date();
    if (scheduledDate <= now) return null; // Already sent or past

    const formattedDate = scheduledDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <span
        className="badge-primary"
        title={`Scheduled for ${scheduledDate.toLocaleString()}`}
      >
        Scheduled: {formattedDate}
      </span>
    );
  };

  const canSend = person.email && !sendStatus;

  // Generate initials for avatar
  const initials = person.fullName
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="group relative card-hover p-5 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
      {onHide && person.userCandidateId && (
        <button
          onClick={onHide}
          className="absolute top-3 right-3 p-1.5 text-surface-400 hover:text-surface-600 hover:bg-surface-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
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

      <div className="flex gap-4 flex-1">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-semibold text-sm">{initials}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 pr-6">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-surface-900">{person.fullName}</h3>
            {getStatusBadge()}
            {getScheduledBadge()}
          </div>
          <p className="text-sm text-surface-600 font-medium">
            {person.role ? `${person.role} at ` : ''}
            <span className="text-surface-800">{person.company}</span>
          </p>

          {/* Email with badge */}
          <div className="flex items-center gap-2 mt-2">
            <EnvelopeIcon className="w-4 h-4 text-surface-400" />
            {person.email ? (
              <>
                <p className="text-sm text-primary-600 font-medium">{person.email}</p>
                {getEmailStatusBadge()}
              </>
            ) : (
              <>
                <p className="text-sm text-surface-400 italic">No email found</p>
                {getEmailStatusBadge()}
              </>
            )}
          </div>

          {/* Education info */}
          {person.education?.schoolName && (
            <div className="flex items-center gap-2 mt-1.5">
              <AcademicCapIcon className="w-4 h-4 text-surface-400" />
              <p className="text-sm text-surface-500">
                {person.education.degree && `${person.education.degree}, `}
                {person.education.schoolName}
                {person.education.graduationYear && ` (${person.education.graduationYear})`}
              </p>
            </div>
          )}

          {/* Location info */}
          {(person.city || person.state) && (
            <div className="flex items-center gap-2 mt-1.5">
              <MapPinIcon className="w-4 h-4 text-surface-400" />
              <p className="text-sm text-surface-500">
                {[person.city, person.state].filter(Boolean).join(', ')}
              </p>
            </div>
          )}

          {person.linkedinUrl && (
            <a
              href={person.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs font-medium text-white bg-[#0A66C2] rounded-lg hover:bg-[#004182] transition-all hover:shadow-md"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              LinkedIn
            </a>
          )}
        </div>
      </div>

      <div className="flex gap-2 md:self-center">
        <button
          onClick={onExpand}
          className="btn-primary text-sm"
        >
          <EnvelopeIcon className="w-4 h-4 mr-1.5" />
          Send
        </button>
      </div>
    </div>
  );
}
