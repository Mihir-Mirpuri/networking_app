'use client';

import { useState, useMemo } from 'react';
import { SavedForLaterEntry, removeSavedForLater } from '@/app/actions/outreach';

interface SavedForLaterSectionProps {
  profiles: SavedForLaterEntry[];
  onProfileRemoved: (id: string) => void;
}

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search saved profiles..."
        className="w-full pl-10 pr-4 py-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#6364FF] transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

const AVATAR_COLORS = ['#6364FF', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];

function getAvatarColor(name: string, email: string | null): string {
  const str = name || email || '';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
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

export function SavedForLaterSection({
  profiles,
  onProfileRemoved,
}: SavedForLaterSectionProps) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profiles;
    const q = searchQuery.toLowerCase();
    return profiles.filter((p) =>
      p.contactName.toLowerCase().includes(q) ||
      p.company.toLowerCase().includes(q) ||
      (p.role?.toLowerCase().includes(q)) ||
      (p.location?.toLowerCase().includes(q)) ||
      (p.contactEmail?.toLowerCase().includes(q))
    );
  }, [profiles, searchQuery]);

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      const result = await removeSavedForLater(id);
      if (result.success) {
        onProfileRemoved(id);
      }
    } catch (error) {
      console.error('Error removing saved profile:', error);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      {/* Search bar */}
      <SearchInput value={searchQuery} onChange={setSearchQuery} />

      <div className="flex-1 flex flex-col min-h-0 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg overflow-hidden">
      {/* Header Row */}
      <div className="flex-shrink-0 flex items-center px-4 py-2.5 bg-[#2a2a2a] border-b border-[#3a3a3a]">
        <div className="w-10 min-w-[40px] shrink-0" />
        <div className="w-[200px] px-2 shrink-0">
          <span className="text-[13px] font-semibold text-white font-['Inter']">Name</span>
        </div>
        <div className="w-[160px] px-2 shrink-0">
          <span className="text-[13px] font-semibold text-white font-['Inter']">Company</span>
        </div>
        <div className="w-[160px] px-2 shrink-0">
          <span className="text-[13px] font-semibold text-white font-['Inter']">Role</span>
        </div>
        <div className="w-[140px] px-2 shrink-0">
          <span className="text-[13px] font-semibold text-white font-['Inter']">Location</span>
        </div>
        <div className="flex-1 px-2">
          <span className="text-[13px] font-semibold text-white font-['Inter']">Email</span>
        </div>
        <div className="w-10 min-w-[40px] shrink-0" />
      </div>

      {/* Data Rows */}
      <div className="flex-1 overflow-y-auto">
        {filteredProfiles.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[#666] text-sm">
            No results found
          </div>
        ) : filteredProfiles.map((profile) => {
          const avatarColor = getAvatarColor(profile.contactName, profile.contactEmail);
          const initials = getInitials(profile.contactName);

          return (
            <div
              key={profile.id}
              className="flex items-center px-4 py-2.5 bg-[#1a1a1a] border-b border-[#2a2a2a] hover:bg-[#252525] group"
            >
              {/* Avatar */}
              <div className="w-10 min-w-[40px] flex justify-center shrink-0">
                <div
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center"
                  style={{ backgroundColor: avatarColor }}
                >
                  <span className="text-[11px] font-semibold text-white font-['Inter']">{initials}</span>
                </div>
              </div>

              {/* Name */}
              <div className="w-[200px] px-2 shrink-0">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13px] font-medium text-white font-['Inter'] truncate">
                    {profile.contactName}
                  </span>
                  {profile.linkedinUrl && (
                    <a
                      href={profile.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-[#0A66C2] hover:underline truncate"
                      onClick={(e) => e.stopPropagation()}
                    >
                      LinkedIn
                    </a>
                  )}
                </div>
              </div>

              {/* Company */}
              <div className="w-[160px] px-2 shrink-0">
                <span className="text-[13px] text-white font-['Inter'] truncate block">
                  {profile.company || <span className="text-[#555]">--</span>}
                </span>
              </div>

              {/* Role */}
              <div className="w-[160px] px-2 shrink-0">
                <span className="text-[13px] text-white font-['Inter'] truncate block">
                  {profile.role || <span className="text-[#555]">--</span>}
                </span>
              </div>

              {/* Location */}
              <div className="w-[140px] px-2 shrink-0">
                <span className="text-[13px] text-white font-['Inter'] truncate block">
                  {profile.location || <span className="text-[#555]">--</span>}
                </span>
              </div>

              {/* Email */}
              <div className="flex-1 px-2 min-w-0">
                <span className="text-[13px] text-white font-['Inter'] truncate block">
                  {profile.contactEmail || <span className="text-[#555]">No email</span>}
                </span>
              </div>

              {/* Remove button */}
              <div className="w-10 min-w-[40px] flex justify-center shrink-0">
                <button
                  onClick={() => handleRemove(profile.id)}
                  disabled={removingId === profile.id}
                  className="p-1 text-[#505050] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-all rounded disabled:opacity-50"
                  title="Remove from saved"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
