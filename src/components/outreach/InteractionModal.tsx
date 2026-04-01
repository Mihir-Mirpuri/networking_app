'use client';

import { useState } from 'react';
import { InteractionType } from '@prisma/client';

interface InteractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (spokeToThem: boolean, interactionType: InteractionType, interactionDate: Date | null) => Promise<void>;
  currentSpokeToThem: boolean;
  currentInteractionType: InteractionType;
  currentInteractionDate: Date | null;
  contactName: string | null;
}

const INTERACTION_OPTIONS: { value: InteractionType; label: string }[] = [
  { value: 'NONE', label: 'None' },
  { value: 'PHONE', label: 'Phone Call' },
  { value: 'VIDEO', label: 'Video Call' },
  { value: 'COFFEE_CHAT', label: 'Coffee Chat' },
  { value: 'IN_PERSON', label: 'In Person' },
  { value: 'OTHER', label: 'Other' },
];

export function InteractionModal({
  isOpen,
  onClose,
  onSave,
  currentSpokeToThem,
  currentInteractionType,
  currentInteractionDate,
  contactName,
}: InteractionModalProps) {
  const [spokeToThem, setSpokeToThem] = useState(currentSpokeToThem);
  const [interactionType, setInteractionType] = useState<InteractionType>(currentInteractionType);
  const [interactionDate, setInteractionDate] = useState<string>(
    currentInteractionDate ? new Date(currentInteractionDate).toISOString().slice(0, 10) : ''
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const date = interactionDate ? new Date(interactionDate) : null;
      await onSave(spokeToThem, interactionType, date);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save interaction');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await onSave(false, 'NONE', null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear interaction');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#2a2a2a] rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Log Interaction {contactName && <span className="text-white">with {contactName}</span>}
        </h3>

        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={spokeToThem}
              onChange={(e) => setSpokeToThem(e.target.checked)}
              className="w-4 h-4 text-white border-[#404040] rounded focus:ring-[#606060]"
            />
            <span className="text-sm font-medium text-white">Spoke to them</span>
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-white mb-2">
            Interaction Type
          </label>
          <select
            value={interactionType}
            onChange={(e) => setInteractionType(e.target.value as InteractionType)}
            className="w-full px-3 py-2 border border-[#404040] rounded-md bg-[#1a1a1a] text-white focus:outline-none focus:ring-2 focus:ring-[#606060]"
          >
            {INTERACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-white mb-2">
            Date (optional)
          </label>
          <input
            type="date"
            value={interactionDate}
            onChange={(e) => setInteractionDate(e.target.value)}
            className="w-full px-3 py-2 border border-[#404040] rounded-md bg-[#1a1a1a] text-white focus:outline-none focus:ring-2 focus:ring-[#606060]"
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-between">
          <button
            onClick={handleClear}
            disabled={isSaving || (!currentSpokeToThem && currentInteractionType === 'NONE')}
            className="px-4 py-2 text-sm text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
          <div className="flex gap-2">
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
    </div>
  );
}

export function getInteractionLabel(type: InteractionType): string {
  const option = INTERACTION_OPTIONS.find((o) => o.value === type);
  return option?.label || 'None';
}
