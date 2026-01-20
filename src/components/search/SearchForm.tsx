'use client';

import { useState } from 'react';
import { COMPANIES, ROLES, UNIVERSITIES, LOCATIONS, EMAIL_TEMPLATES } from '@/lib/constants';
import { LoadingSpinner } from './LoadingSpinner';
import { SearchableCombobox } from './SearchableCombobox';

interface SearchFormProps {
  onSearch: (params: {
    company: string;
    role: string;
    university: string;
    location: string;
    limit: number;
    templateId: string;
  }) => void;
  isLoading: boolean;
}

export function SearchForm({ onSearch, isLoading }: SearchFormProps) {
  const [company, setCompany] = useState<string>(COMPANIES[0]);
  const [role, setRole] = useState<string>(ROLES[0]);
  const [university, setUniversity] = useState<string>(UNIVERSITIES[0]);
  const [location, setLocation] = useState<string>(LOCATIONS[0]);
  const [limit, setLimit] = useState(10);
  const [templateId, setTemplateId] = useState<string>(EMAIL_TEMPLATES[0].id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({ company, role, university, location, limit, templateId });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {/* Company */}
        <SearchableCombobox
          options={COMPANIES}
          value={company}
          onChange={setCompany}
          label="Company"
          placeholder="Search companies..."
          id="company"
        />

        {/* Role */}
        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
            Role
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* University */}
        <SearchableCombobox
          options={UNIVERSITIES}
          value={university}
          onChange={setUniversity}
          label="University"
          placeholder="Search universities..."
          id="university"
        />

        {/* Office Location */}
        <div>
          <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
            Office Location
          </label>
          <select
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {LOCATIONS.map((loc) => (
              <option key={loc || 'any'} value={loc}>
                {loc || 'Any Location'}
              </option>
            ))}
          </select>
        </div>

        {/* Number of Results */}
        <div>
          <label htmlFor="limit" className="block text-sm font-medium text-gray-700 mb-1">
            Number of Results
          </label>
          <select
            id="limit"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {/* Template */}
        <div>
          <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-1">
            Email Template
          </label>
          <select
            id="template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {EMAIL_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isLoading && <LoadingSpinner size="sm" />}
        {isLoading ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
}
