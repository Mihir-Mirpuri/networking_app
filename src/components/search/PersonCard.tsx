'use client';

import { SearchResultWithDraft } from '@/app/actions/search';
import { EnvelopeIcon, AcademicCapIcon, MapPinIcon, BuildingOfficeIcon, CheckIcon } from '@heroicons/react/24/outline';

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

  const gradient = nameToGradient(person.fullName);
  const isSent = sendStatus === 'success';
  const isFailed = sendStatus === 'failed';

  return (
    <div className={`group relative card-hover p-5 flex flex-col items-center text-center hover:-translate-y-0.5 ${
      (isSent || isFailed) ? 'opacity-60 saturate-50' : ''
    }`}>
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
        <div className="relative">
          <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md`}>
            <span className="text-white font-semibold text-lg">{initials}</span>
          </div>
          {/* Sent check overlay */}
          {isSent && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/80 flex items-center justify-center">
                <CheckIcon className="w-7 h-7 text-white" strokeWidth={2.5} />
              </div>
            </div>
          )}
          {/* Failed X overlay */}
          {isFailed && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-red-500/80 flex items-center justify-center">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
          )}
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
        {isSent ? (
          <button
            onClick={onExpand}
            className="text-sm w-full justify-center btn-secondary text-emerald-600 border-emerald-200"
          >
            <CheckIcon className="w-4 h-4 mr-1.5" />
            Sent
          </button>
        ) : isFailed ? (
          <button
            onClick={onExpand}
            className="text-sm w-full justify-center btn-secondary text-red-600 border-red-200"
          >
            Failed
          </button>
        ) : (
          <button
            onClick={onExpand}
            className="text-sm w-full justify-center btn-primary"
          >
            <EnvelopeIcon className="w-4 h-4 mr-1.5" />
            Send Email
          </button>
        )}
      </div>
    </div>
  );
}
