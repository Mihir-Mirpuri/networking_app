'use client';

import { useState } from 'react';
import { SearchableCombobox } from '@/components/search/SearchableCombobox';
import { UNIVERSITIES, CLASSIFICATIONS } from '@/lib/constants';

interface ProfileCompletionModalProps {
  open: boolean;
  missingFields: {
    university: boolean;
    classification: boolean;
    major: boolean;
    career: boolean;
  };
  initial: {
    university: string | null;
    classification: string | null;
    major: string | null;
    career: string | null;
  };
  onSave: (data: {
    university?: string;
    classification?: string;
    major?: string;
    career?: string;
  }) => Promise<void>;
  onCancel: () => void;
}

const inputClass =
  'w-full bg-[#252525] border border-[#333] rounded-md px-3 py-2 text-sm text-white placeholder-[#666] focus:outline-none focus:border-[var(--accent)] transition-colors';

export function ProfileCompletionModal({
  open,
  missingFields,
  initial,
  onSave,
  onCancel,
}: ProfileCompletionModalProps) {
  const [university, setUniversity] = useState(initial.university ?? '');
  const [classification, setClassification] = useState(initial.classification ?? '');
  const [major, setMajor] = useState(initial.major ?? '');
  const [career, setCareer] = useState(initial.career ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const isValid =
    (!missingFields.university || university.trim()) &&
    (!missingFields.classification || classification.trim()) &&
    (!missingFields.major || major.trim()) &&
    (!missingFields.career || career.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...(missingFields.university && { university: university.trim() }),
        ...(missingFields.classification && { classification: classification.trim() }),
        ...(missingFields.major && { major: major.trim() }),
        ...(missingFields.career && { career: career.trim() }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl"
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-white">Quick — finish your profile</h2>
          <p className="text-sm text-[#888] mt-1">
            We use these to personalize your outreach.
          </p>
        </div>

        <div className="px-6 pb-5 space-y-4">
          {missingFields.university && (
            <div>
              <label className="block text-xs font-medium text-[#aaa] mb-1.5">University</label>
              <SearchableCombobox
                options={UNIVERSITIES}
                value={university}
                onChange={setUniversity}
                label=""
                placeholder="Search universities..."
                id="profile-modal-university"
              />
            </div>
          )}

          {missingFields.classification && (
            <div>
              <label className="block text-xs font-medium text-[#aaa] mb-1.5">Classification</label>
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                className={inputClass}
              >
                <option value="">Select classification</option>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {missingFields.major && (
            <div>
              <label className="block text-xs font-medium text-[#aaa] mb-1.5">Major</label>
              <input
                type="text"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                placeholder="e.g., Computer Science"
                className={inputClass}
                autoFocus={!missingFields.university && !missingFields.classification}
              />
            </div>
          )}

          {missingFields.career && (
            <div>
              <label className="block text-xs font-medium text-[#aaa] mb-1.5">Career interest</label>
              <input
                type="text"
                value={career}
                onChange={(e) => setCareer(e.target.value)}
                placeholder="e.g., Investment Banking"
                className={inputClass}
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-[#2a2a2a]">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="text-sm text-[#888] hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || saving}
            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[#333] disabled:text-[#666] text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            {saving ? 'Saving…' : 'Save & send'}
          </button>
        </div>
      </form>
    </div>
  );
}
