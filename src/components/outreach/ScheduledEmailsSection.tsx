'use client';

import { useState } from 'react';
import { ScheduledEmailEntry } from '@/app/actions/outreach';
import { cancelScheduledEmailAction, updateScheduledEmailAction } from '@/app/actions/send';

interface ScheduledEmailsSectionProps {
  scheduledEmails: ScheduledEmailEntry[];
  onEmailCancelled: (id: string) => void;
  onEmailUpdated: (id: string, newScheduledFor: Date) => void;
}

const AVATAR_COLORS = ['#6364FF', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];

function getAvatarColor(name: string | null, email: string): string {
  const str = name || email;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function formatCountdown(scheduledFor: Date): string {
  const now = new Date();
  const diff = new Date(scheduledFor).getTime() - now.getTime();
  if (diff <= 0) return 'Sending soon';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatScheduledDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ScheduledEmailsSection({
  scheduledEmails,
  onEmailCancelled,
  onEmailUpdated,
}: ScheduledEmailsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDateTime, setEditDateTime] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  if (scheduledEmails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-full bg-[#2a2a2a] flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-white text-sm font-['Inter']">No scheduled emails</p>
        <p className="text-white text-xs font-['Inter'] mt-1">
          Schedule emails from the compose page to see them here
        </p>
      </div>
    );
  }

  const handleCancel = async (id: string) => {
    setCancelingId(id);
    try {
      const result = await cancelScheduledEmailAction(id);
      if (result.success) {
        onEmailCancelled(id);
      }
    } catch (error) {
      console.error('Error cancelling scheduled email:', error);
    } finally {
      setCancelingId(null);
    }
  };

  const handleEditOpen = (email: ScheduledEmailEntry) => {
    const d = new Date(email.scheduledFor);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setEditingId(email.id);
    setEditDateTime(local);
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (!editingId || !editDateTime) return;

    const selectedDate = new Date(editDateTime);
    const now = new Date();
    const minTime = new Date(now.getTime() + 5 * 60 * 1000);

    if (selectedDate < minTime) {
      setEditError('Must be at least 5 minutes in the future');
      return;
    }

    setIsUpdating(true);
    try {
      const result = await updateScheduledEmailAction(editingId, selectedDate);
      if (result.success) {
        onEmailUpdated(editingId, selectedDate);
        setEditingId(null);
        setEditDateTime('');
        setEditError(null);
      } else {
        setEditError(result.error);
      }
    } catch (error) {
      setEditError('Failed to update');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="mb-4">
      {/* Section Header */}
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-[#6364FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-sm font-semibold text-white font-['Inter']">
          Scheduled Sends
        </h3>
        <span className="text-xs text-white font-['Inter']">
          ({scheduledEmails.length})
        </span>
      </div>

      {/* Scheduled Email Cards */}
      <div className="bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg overflow-hidden">
        {scheduledEmails.map((email, index) => {
          const avatarColor = getAvatarColor(email.contactName, email.toEmail);
          const initials = getInitials(email.contactName, email.toEmail);
          const isExpanded = expandedId === email.id;

          return (
            <div
              key={email.id}
              className={`${index > 0 ? 'border-t border-[#2a2a2a]' : ''}`}
            >
              {/* Row */}
              <div
                className="flex items-center px-4 py-3 hover:bg-[#252525] cursor-pointer transition-colors group"
                onClick={() => setExpandedId(isExpanded ? null : email.id)}
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
                  <span className="text-[13px] font-medium text-white font-['Inter'] truncate">
                    {email.contactName || email.toEmail}
                  </span>
                  <span className="text-[11px] text-white font-['Inter'] truncate">
                    {email.toEmail}
                  </span>
                </div>

                {/* Company */}
                <div className="w-[120px] mr-4">
                  <span className="text-[13px] text-white font-['Inter'] truncate block">
                    {email.company || '--'}
                  </span>
                </div>

                {/* Subject */}
                <div className="flex-1 min-w-0 mr-4">
                  <span className="text-[13px] text-white font-['Inter'] truncate block">
                    {email.subject}
                  </span>
                </div>

                {/* Scheduled badge */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#6364FF]/15 text-[#8b8cff] font-['Inter']">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {formatScheduledDate(email.scheduledFor)}
                  </span>
                  <span className="text-[11px] text-white font-['Inter'] w-[60px] text-right">
                    {formatCountdown(email.scheduledFor)}
                  </span>
                </div>

                {/* Expand chevron */}
                <svg
                  className={`w-4 h-4 text-white ml-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
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
                    <p className="text-xs text-white font-['Inter'] mb-1">Subject</p>
                    <p className="text-[13px] text-white font-['Inter']">{email.subject}</p>
                  </div>
                  <div className="mb-4">
                    <p className="text-xs text-white font-['Inter'] mb-1">Body</p>
                    <p className="text-[13px] text-white font-['Inter'] whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                      {email.body}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditOpen(email);
                      }}
                      className="px-3 py-1.5 text-xs font-medium bg-[#2a2a2a] border border-[#3a3a3a] text-white rounded-lg hover:bg-[#333333] transition-colors font-['Inter'] flex items-center gap-1.5"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Edit Time
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancel(email.id);
                      }}
                      disabled={cancelingId === email.id}
                      className="px-3 py-1.5 text-xs font-medium bg-red-900/20 border border-red-900/30 text-red-400 rounded-lg hover:bg-red-900/30 transition-colors font-['Inter'] flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {cancelingId === email.id ? 'Cancelling...' : 'Cancel Send'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit Schedule Modal */}
      {editingId && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingId(null);
              setEditDateTime('');
              setEditError(null);
            }
          }}
        >
          <div className="bg-[#2a2a2a] rounded-2xl shadow-lg shadow-black/40 max-w-sm w-full p-6 animate-scale-in border border-[#3a3a3a]">
            <h3 className="text-lg font-semibold mb-4 text-white font-['Inter']">Edit Scheduled Time</h3>

            <input
              type="datetime-local"
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg text-white text-sm font-['Inter'] mb-3 focus:outline-none focus:border-[#6364FF]"
              value={editDateTime}
              onChange={(e) => {
                setEditDateTime(e.target.value);
                setEditError(null);
              }}
            />

            {editError && (
              <p className="text-xs text-red-400 mb-3 font-['Inter']">{editError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setEditingId(null);
                  setEditDateTime('');
                  setEditError(null);
                }}
                className="px-4 py-2 text-sm font-medium bg-[#333333] text-white rounded-lg hover:bg-[#3a3a3a] transition-all font-['Inter']"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={isUpdating || !editDateTime}
                className="px-4 py-2 text-sm font-medium bg-[#6364FF] text-white rounded-lg hover:bg-[#5354EE] transition-all font-['Inter'] disabled:opacity-50"
              >
                {isUpdating ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
