'use client';

import { useState, useRef, useEffect } from 'react';
import { OutreachStatus } from '@prisma/client';

interface StatusDropdownProps {
  value: OutreachStatus;
  onChange: (status: OutreachStatus) => void;
  disabled?: boolean;
}

const STATUS_CONFIG: Record<OutreachStatus, { label: string; color: string; bg: string }> = {
  NOT_STARTED: { label: 'Not Started', color: 'text-[#808080]', bg: 'bg-[#2a2a2a]' },
  SENT: { label: 'Sent', color: 'text-[#60a5fa]', bg: 'bg-[#1e3a5f]' },
  WAITING: { label: 'Waiting', color: 'text-[#fbbf24]', bg: 'bg-[#422006]' },
  RESPONDED: { label: 'Responded', color: 'text-[#4ade80]', bg: 'bg-[#14532d]' },
  SCHEDULED_CALL: { label: 'Scheduled', color: 'text-[#a78bfa]', bg: 'bg-[#3b0764]' },
  HAD_CALL: { label: 'Had Call', color: 'text-[#c084fc]', bg: 'bg-[#4c1d95]' },
  GHOSTED: { label: 'Ghosted', color: 'text-[#9ca3af]', bg: 'bg-[#1f2937]' },
  NOT_INTERESTED: { label: 'Not Interested', color: 'text-[#f87171]', bg: 'bg-[#450a0a]' },
  CONNECTED: { label: 'Connected', color: 'text-[#22c55e]', bg: 'bg-[#166534]' },
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
        className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold ${config.bg} ${config.color} transition-all ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:brightness-110'
        }`}
      >
        {config.label}
        {!disabled && (
          <svg className="ml-1.5 h-3 w-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 w-44 bg-[#252525] rounded-xl shadow-xl shadow-black/40 border border-[#353535] overflow-hidden">
          <div className="py-1.5">
            {Object.entries(STATUS_CONFIG).map(([status, statusConfig]) => (
              <button
                key={status}
                onClick={() => {
                  onChange(status as OutreachStatus);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[#333333] flex items-center transition-colors ${
                  status === value ? 'bg-[#333333]' : ''
                }`}
              >
                <span
                  className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.color}`}
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
