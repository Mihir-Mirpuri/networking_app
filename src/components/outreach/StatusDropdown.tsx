'use client';

import { useState, useRef, useEffect } from 'react';
import { OutreachStatus } from '@prisma/client';

interface StatusDropdownProps {
  value: OutreachStatus;
  onChange: (status: OutreachStatus) => void;
  disabled?: boolean;
}

const STATUS_CONFIG: Record<OutreachStatus, { label: string; color: string; bg: string }> = {
  NOT_STARTED: { label: 'Not Started', color: 'text-gray-700', bg: 'bg-gray-100' },
  SENT: { label: 'Sent', color: 'text-blue-700', bg: 'bg-blue-100' },
  WAITING: { label: 'Waiting', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  RESPONDED: { label: 'Responded', color: 'text-green-700', bg: 'bg-green-100' },
  SCHEDULED_CALL: { label: 'Scheduled Call', color: 'text-purple-700', bg: 'bg-purple-100' },
  HAD_CALL: { label: 'Had Call', color: 'text-indigo-700', bg: 'bg-indigo-100' },
  GHOSTED: { label: 'Ghosted', color: 'text-red-700', bg: 'bg-red-100' },
  NOT_INTERESTED: { label: 'Not Interested', color: 'text-orange-700', bg: 'bg-orange-100' },
  CONNECTED: { label: 'Connected', color: 'text-emerald-700', bg: 'bg-emerald-100' },
};

export function StatusDropdown({ value, onChange, disabled }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const config = STATUS_CONFIG[value];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color} ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'
        }`}
      >
        {config.label}
        {!disabled && (
          <svg className="ml-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200">
          <div className="py-1">
            {Object.entries(STATUS_CONFIG).map(([status, statusConfig]) => (
              <button
                key={status}
                onClick={() => {
                  onChange(status as OutreachStatus);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center ${
                  status === value ? 'bg-gray-50' : ''
                }`}
              >
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.color}`}
                >
                  {statusConfig.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function getStatusConfig(status: OutreachStatus) {
  return STATUS_CONFIG[status];
}
