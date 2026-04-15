'use client';

import { useState } from 'react';
import { DraftEntry, deleteDraft } from '@/app/actions/outreach';

interface DraftsSectionProps {
  drafts: DraftEntry[];
  onDraftDeleted: (id: string) => void;
}

const AVATAR_COLORS = ['#6364FF', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function DraftsSection({ drafts, onDraftDeleted }: DraftsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-full bg-[#2a2a2a] flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-[#505050]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-[#707070] text-sm font-['Inter']">No drafts yet</p>
        <p className="text-[#505050] text-xs font-['Inter'] mt-1">
          Drafts are created when you open a profile to compose an email
        </p>
      </div>
    );
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const result = await deleteDraft(id);
      if (result.success) {
        onDraftDeleted(id);
        if (expandedId === id) setExpandedId(null);
      }
    } catch (error) {
      console.error('Error deleting draft:', error);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mb-4">
      {/* Section Header */}
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-[var(--accent-text)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <h3 className="text-sm font-semibold text-[#E0E0E0] font-['Inter']">
          Drafts
        </h3>
        <span className="text-xs text-[#707070] font-['Inter']">
          ({drafts.length})
        </span>
      </div>

      {/* Draft Cards */}
      <div className="bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg overflow-hidden">
        {drafts.map((draft, index) => {
          const avatarColor = getAvatarColor(draft.contactName);
          const initials = getInitials(draft.contactName);
          const isExpanded = expandedId === draft.id;

          return (
            <div
              key={draft.id}
              className={`${index > 0 ? 'border-t border-[#2a2a2a]' : ''}`}
            >
              {/* Row */}
              <div
                className="flex items-center px-4 py-3 hover:bg-[#252525] cursor-pointer transition-colors group"
                onClick={() => setExpandedId(isExpanded ? null : draft.id)}
              >
                {/* Avatar */}
                <div
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 mr-3"
                  style={{ backgroundColor: avatarColor }}
                >
                  <span className="text-[11px] font-semibold text-white font-['Inter']">{initials}</span>
                </div>

                {/* Name & Email */}
                <div className="flex flex-col gap-0.5 min-w-0 w-[180px] mr-4">
                  <span className="text-[13px] font-medium text-[#E0E0E0] font-['Inter'] truncate">
                    {draft.contactName}
                  </span>
                  <span className="text-[11px] text-[#707070] font-['Inter'] truncate">
                    {draft.contactEmail || 'No email'}
                  </span>
                </div>

                {/* Company */}
                <div className="w-[120px] mr-4">
                  <span className="text-[13px] text-[#909090] font-['Inter'] truncate block">
                    {draft.company || '--'}
                  </span>
                </div>

                {/* Role */}
                <div className="w-[120px] mr-4 hidden sm:block">
                  <span className="text-[13px] text-[#909090] font-['Inter'] truncate block">
                    {draft.role || '--'}
                  </span>
                </div>

                {/* Subject */}
                <div className="flex-1 min-w-0 mr-4">
                  <span className="text-[13px] text-[#707070] font-['Inter'] truncate block">
                    {draft.subject}
                  </span>
                </div>

                {/* Draft badge */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#f59e0b]/15 text-[#fbbf24] font-['Inter']">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Draft
                  </span>
                  <span className="text-[11px] text-[#707070] font-['Inter'] w-[80px] text-right">
                    {formatDate(draft.updatedAt)}
                  </span>
                </div>

                {/* Expand chevron */}
                <svg
                  className={`w-4 h-4 text-[#606060] ml-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 bg-[#222222] border-t border-[#2a2a2a]">
                  {/* Email preview */}
                  <div className="mb-3">
                    <p className="text-xs text-[#606060] font-['Inter'] mb-1">Subject</p>
                    <p className="text-[13px] text-[#c0c0c0] font-['Inter']">{draft.subject}</p>
                  </div>
                  <div className="mb-4">
                    <p className="text-xs text-[#606060] font-['Inter'] mb-1">Body</p>
                    <p className="text-[13px] text-[#909090] font-['Inter'] whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                      {draft.body}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(draft.id);
                      }}
                      disabled={deletingId === draft.id}
                      className="px-3 py-1.5 text-xs font-medium bg-red-900/20 border border-red-900/30 text-red-400 rounded-lg hover:bg-red-900/30 transition-colors font-['Inter'] flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      {deletingId === draft.id ? 'Deleting...' : 'Delete Draft'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
