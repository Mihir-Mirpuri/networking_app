'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { INDUSTRIES, COMPANIES_BY_INDUSTRY, ROLES_BY_COMPANY, UNIVERSITIES, LOCATIONS, EMAIL_TEMPLATES } from '@/lib/constants';
import { LoadingSpinner } from './LoadingSpinner';
import { SearchableCombobox } from './SearchableCombobox';
import { getTemplatesAction, TemplateData } from '@/app/actions/profile';


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
    templateId: string;
  } | null;
}

export function SearchForm({ onSearch, isLoading, initialParams }: SearchFormProps) {
  const { status } = useSession();

  // Initialize with initialParams if available, otherwise empty (user must select)
  const [industry, setIndustry] = useState<string>(INDUSTRIES[0]); // Default to first industry (Consulting)
  const [company, setCompany] = useState<string>(initialParams?.company || '');
  const [role, setRole] = useState<string>(initialParams?.role || '');

  // Get companies for the selected industry
  const availableCompanies = industry ? (COMPANIES_BY_INDUSTRY[industry] || []) : [];

  // Get roles for the selected company
  const availableRoles = company ? (ROLES_BY_COMPANY[company] || []) : [];
  const [university, setUniversity] = useState<string>(initialParams?.university || '');
  const [location, setLocation] = useState<string>(initialParams?.location || '');
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
      limit: 10,
      templateId,
    });
  };

  // Check if at least one search parameter is filled
  const hasSearchParams = company || role || university || location;

  return (
    <form onSubmit={handleSubmit} className="card p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {/* Industry */}
        <div>
          <label htmlFor="industry" className="block text-sm font-medium text-surface-700 mb-1.5">
            Industry
          </label>
          <select
            id="industry"
            value={industry}
            onChange={(e) => {
              setIndustry(e.target.value);
              setCompany(''); // Reset company when industry changes
            }}
            className="input"
          >
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>
        </div>

        {/* Company */}
        <SearchableCombobox
          options={['', ...availableCompanies]}
          value={company}
          onChange={(val) => {
            setCompany(val);
            setRole(''); // Reset role when company changes
          }}
          label="Company"
          placeholder="Select a company..."
          id="company"
        />

        {/* Role */}
        <SearchableCombobox
          options={['', ...availableRoles]}
          value={role}
          onChange={setRole}
          label="Role"
          placeholder={company ? "Select a role..." : "Select a company first..."}
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

        {/* Template */}
        <div>
          <label htmlFor="template" className="block text-sm font-medium text-surface-700 mb-1.5">
            Email Template
          </label>
          <select
            id="template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={isLoadingTemplates}
            className="input"
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
          {templateError && <p className="mt-1.5 text-sm text-amber-600">{templateError}</p>}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isLoading || !hasSearchParams}
          className="btn-primary"
        >
          {isLoading && <LoadingSpinner size="sm" />}
          {isLoading ? 'Searching...' : 'Search Contacts'}
        </button>
        {!hasSearchParams && (
          <p className="text-sm text-surface-500">
            Fill in at least one field to search
          </p>
        )}
      </div>
    </form>
  );
}
