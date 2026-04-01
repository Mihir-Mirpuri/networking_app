'use client';

import { useState } from 'react';

interface NotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (notes: string | null) => Promise<void>;
  currentNotes: string | null;
  contactName: string | null;
}

export function NotesModal({
  isOpen,
  onClose,
  onSave,
  currentNotes,
  contactName,
}: NotesModalProps) {
  const [notes, setNotes] = useState(currentNotes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await onSave(notes.trim() || null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save notes');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#2a2a2a] rounded-lg shadow-xl max-w-lg w-full p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Notes {contactName && <span className="text-white">for {contactName}</span>}
        </h3>

        <div className="mb-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={8}
            placeholder="Add notes about this contact..."
            className="w-full px-3 py-2 border border-[#404040] rounded-md bg-[#1a1a1a] text-white placeholder:text-white focus:outline-none focus:ring-2 focus:ring-[#606060] resize-y"
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm border border-[#404040] text-white rounded-md hover:bg-[#333333] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm bg-[#505050] text-white rounded-md hover:bg-[#606060] focus:outline-none focus:ring-2 focus:ring-[#606060] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
