'use client';

import { useState } from 'react';
import { COMPANIES, ROLES, ROLES_BY_COMPANY, LOCATIONS } from '@/lib/constants';
import { SearchableCombobox } from '@/components/search/SearchableCombobox';

interface FilterPopoverProps {
  onApply: (filters: { company?: string; role?: string; university?: string; location?: string }) => void;
  onClose: () => void;
  initialFilters?: { company?: string; role?: string; university?: string; location?: string };
}

export function FilterPopover({ onApply, onClose, initialFilters }: FilterPopoverProps) {
  const [company, setCompany] = useState(initialFilters?.company || '');
  const [role, setRole] = useState(initialFilters?.role || '');
  const [university, setUniversity] = useState(initialFilters?.university || '');
  const [location, setLocation] = useState(initialFilters?.location || '');

  const availableRoles = company
    ? (ROLES_BY_COMPANY[company] || [...ROLES])
    : [...ROLES];

  const hasParams = company || role || university || location;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 p-4 bg-[#111111] border border-[#2a2a2a] rounded-xl shadow-lg z-50 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Filters</h3>
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-600 transition-colors"
          aria-label="Close filters"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="space-y-3">
        <SearchableCombobox
          options={[
            { label: 'Any Company', value: '' },
            ...COMPANIES.map((c) => ({ label: c, value: c })),
          ]}
          value={company}
          onChange={(val) => {
            setCompany(val);
            if (val && ROLES_BY_COMPANY[val]) {
              setRole('');
            }
          }}
          label="Company"
          placeholder="Type or select a company..."
          id="filter-company"
          allowFreeText
        />
        <SearchableCombobox
          options={[
            { label: 'Any Role', value: '' },
            ...availableRoles.map((r) => ({ label: r, value: r })),
          ]}
          value={role}
          onChange={setRole}
          label="Role"
          placeholder="Type or select a role..."
          id="filter-role"
          allowFreeText
        />
        <SearchableCombobox
          options={[
            { label: 'Any University', value: '' },
            { label: 'University of Texas at Austin', value: 'University of Texas at Austin' },
            { label: 'Texas A&M University', value: 'Texas A&M University' },
          ]}
          value={university}
          onChange={setUniversity}
          label="University"
          placeholder="Type or select a university..."
          id="filter-university"
          allowFreeText
        />
        <SearchableCombobox
          options={[
            { label: 'Any Location', value: '' },
            ...LOCATIONS.filter((loc) => loc !== '').map((loc) => ({
              label: loc,
              value: loc,
            })),
          ]}
          value={location}
          onChange={setLocation}
          label="Office Location"
          placeholder="Type or select a location..."
          id="filter-location"
          allowFreeText
        />
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={onClose} className="btn-secondary flex-1 text-sm">
          Cancel
        </button>
        <button
          onClick={() => onApply({
            company: company || undefined,
            role: role || undefined,
            university: university || undefined,
            location: location || undefined,
          })}
          disabled={!hasParams}
          className="btn-primary flex-1 text-sm disabled:opacity-50"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
}
