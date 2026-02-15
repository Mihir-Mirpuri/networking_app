'use client';

import { useState, useEffect } from 'react';
import { COMPANIES, ROLES, ROLES_BY_COMPANY, LOCATIONS } from '@/lib/constants';
import { LoadingSpinner } from './LoadingSpinner';
import { SearchableCombobox } from './SearchableCombobox';
import { CreditsDisplay } from '@/components/credits';


interface SearchFormProps {
  onSearch: (params: {
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    limit: number;
  }) => void;
  isLoading: boolean;
  initialParams?: {
    company?: string;
    role?: string;
    university?: string;
    location?: string;
  } | null;
}

export function SearchForm({ onSearch, isLoading, initialParams }: SearchFormProps) {
  const [company, setCompany] = useState<string>(initialParams?.company || '');
  const [role, setRole] = useState<string>(initialParams?.role || '');

  // Get roles for the selected company, fall back to generic roles list
  const availableRoles = company
    ? (ROLES_BY_COMPANY[company] || [...ROLES])
    : [...ROLES];
  const [university, setUniversity] = useState<string>(initialParams?.university || '');
  const [location, setLocation] = useState<string>(initialParams?.location || '');

  // Update form fields when initialParams are restored from sessionStorage
  useEffect(() => {
    if (initialParams) {
      setCompany(initialParams.company || '');
      setRole(initialParams.role || '');
      setUniversity(initialParams.university || '');
      setLocation(initialParams.location || '');
    }
  }, [initialParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({
      company: company || undefined,
      role: role || undefined,
      university: university || undefined,
      location: location || undefined,
      limit: 10,
    });
  };

  // Check if at least one search parameter is filled
  const hasSearchParams = company || role || university || location;

  return (
    <form onSubmit={handleSubmit} className="card p-6 mb-6">
      <h2 className="text-xl font-bold text-surface-900 mb-4">Find People</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {/* Company */}
        <div>
          <SearchableCombobox
            options={[
              { label: 'Any Company', value: '' },
              ...COMPANIES.map((c) => ({ label: c, value: c })),
            ]}
            value={company}
            onChange={(val) => {
              setCompany(val);
              setRole(''); // Reset role when company changes
            }}
            label="Company"
            placeholder="Type or select a company..."
            id="company"
            allowFreeText
          />
        </div>

        {/* Role */}
        <div>
          <SearchableCombobox
            options={[
              { label: 'Any Role', value: '' },
              ...availableRoles.map((r) => ({ label: r, value: r })),
            ]}
            value={role}
            onChange={setRole}
            label="Role"
            placeholder="Type or select a role..."
            id="role"
            allowFreeText
          />
        </div>

        {/* University */}
        <div>
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
            id="university"
            allowFreeText
          />
        </div>

        {/* Office Location */}
        <div>
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
            id="location"
            allowFreeText
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isLoading || !hasSearchParams}
            className="btn-primary"
          >
            {isLoading && <LoadingSpinner size="sm" />}
            {isLoading ? 'Searching...' : 'Search'}
          </button>
          {!hasSearchParams && (
            <p className="text-sm text-surface-500">
              Fill in at least one field to search
            </p>
          )}
        </div>
        <CreditsDisplay />
      </div>
    </form>
  );
}
