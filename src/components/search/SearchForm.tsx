'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { COMPANIES, UNIVERSITIES, LOCATIONS, EMAIL_TEMPLATES } from '@/lib/constants';
import { LoadingSpinner } from './LoadingSpinner';
import { SearchableCombobox } from './SearchableCombobox';
import { getTemplatesAction, TemplateData } from '@/app/actions/profile';

// Role options with display label and search value
const ROLE_OPTIONS = [
  { label: 'Investment Banking Analyst', value: 'Investment Banking Analyst' },
  { label: 'Consulting Associate', value: 'Associate' },
] as const;

interface SearchFormProps {
  onSearch: (params: {
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    limit: number;
    templateId: string;
  }) => void;
  isLoading: boolean;
  initialParams?: {
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    limit: number;
    templateId: string;
  } | null;
}

export function SearchForm({ onSearch, isLoading, initialParams }: SearchFormProps) {
  const { status } = useSession();

  // Initialize with initialParams if available, otherwise empty (user must select)
  const [company, setCompany] = useState<string>(initialParams?.company || '');
  const [role, setRole] = useState<string>(initialParams?.role || '');
  const [university, setUniversity] = useState<string>(initialParams?.university || '');
  const [location, setLocation] = useState<string>(initialParams?.location || '');
  const [limit, setLimit] = useState(initialParams?.limit || 10);
  const [templateId, setTemplateId] = useState<string>(
    initialParams?.templateId || EMAIL_TEMPLATES[0].id
  );

  // Template state
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // Fetch user templates on mount - but only when session is ready
  useEffect(() => {
    if (status === 'authenticated') {
      const loadTemplates = async () => {
        setIsLoadingTemplates(true);
        setTemplateError(null);

        const result = await getTemplatesAction();

        if (result.success) {
          // Combine user templates with hardcoded default
          const hardcodedDefault = EMAIL_TEMPLATES[0];
          const combinedTemplates = [
            ...result.templates,
            {
              id: hardcodedDefault.id,
              name: hardcodedDefault.name,
              subject: hardcodedDefault.subject,
              body: hardcodedDefault.body,
              isDefault: false,
              attachResume: false,
              resumeId: null,
              createdAt: new Date(),
            },
          ];

          setTemplates(combinedTemplates);

          // Set initial templateId to user's default template or fallback
          // But only if we don't have initialParams with a templateId
          if (!initialParams?.templateId) {
            if (result.templates.length > 0) {
              const defaultTemplate = result.templates.find((t) => t.isDefault);
              if (defaultTemplate) {
                setTemplateId(defaultTemplate.id);
              } else {
                setTemplateId(result.templates[0].id);
              }
            } else {
              // No user templates, use hardcoded default
              setTemplateId(hardcodedDefault.id);
            }
          }
        } else {
          // Error fetching templates, fallback to hardcoded default only
          setTemplateError(result.error || 'Failed to load templates');
          const hardcodedDefault = EMAIL_TEMPLATES[0];
          setTemplates([
            {
              id: hardcodedDefault.id,
              name: hardcodedDefault.name,
              subject: hardcodedDefault.subject,
              body: hardcodedDefault.body,
              isDefault: false,
              attachResume: false,
              resumeId: null,
              createdAt: new Date(),
            },
          ]);
          if (!initialParams?.templateId) {
            setTemplateId(hardcodedDefault.id);
          }
        }

        setIsLoadingTemplates(false);
      };

      loadTemplates();
    }
  }, [status, initialParams?.templateId]);

  // Update form fields when initialParams are restored from sessionStorage
  useEffect(() => {
    if (initialParams) {
      setCompany(initialParams.company || '');
      setRole(initialParams.role || '');
      setUniversity(initialParams.university || '');
      setLocation(initialParams.location || '');
      setLimit(initialParams.limit);

      // Only set templateId if templates are loaded
      if (templates.length > 0 || !isLoadingTemplates) {
        // Verify templateId exists in available templates
        const templateExists =
          templates.some((t) => t.id === initialParams.templateId) ||
          initialParams.templateId === EMAIL_TEMPLATES[0].id;
        if (templateExists) {
          setTemplateId(initialParams.templateId);
        }
      }
    }
  }, [initialParams, templates, isLoadingTemplates]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({
      company: company || undefined,
      role: role || undefined,
      university: university || undefined,
      location: location || undefined,
      limit,
      templateId,
    });
  };

  // Check if at least one search parameter is filled
  const hasSearchParams = company || role || university || location;

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {/* Company */}
        <SearchableCombobox
          options={['', ...COMPANIES]}
          value={company}
          onChange={setCompany}
          label="Company"
          placeholder="Select a company..."
          id="company"
        />

        {/* Role */}
        <SearchableCombobox
          options={ROLE_OPTIONS}
          value={role}
          onChange={setRole}
          label="Role"
          placeholder="Select a role..."
          id="role"
        />

        {/* University */}
        <SearchableCombobox
          options={['', ...UNIVERSITIES]}
          value={university}
          onChange={setUniversity}
          label="University"
          placeholder="Select a university..."
          id="university"
        />

        {/* Office Location */}
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
          placeholder="Select a location..."
          id="location"
        />

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
            disabled={isLoadingTemplates}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingTemplates ? (
              <option value="">Loading templates...</option>
            ) : templates.length === 0 ? (
              <option value={EMAIL_TEMPLATES[0].id}>{EMAIL_TEMPLATES[0].name}</option>
            ) : (
              templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? ' (Default)' : ''}
                </option>
              ))
            )}
          </select>
          {templateError && <p className="mt-1 text-sm text-amber-600">{templateError}</p>}
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading || !hasSearchParams}
        className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isLoading && <LoadingSpinner size="sm" />}
        {isLoading ? 'Searching...' : 'Search'}
      </button>
      {!hasSearchParams && (
        <p className="mt-2 text-sm text-gray-500">
          Please fill in at least one search field (company, role, university, or location)
        </p>
      )}
    </form>
  );
}
