'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { COMPANIES, ROLES, ROLES_BY_COMPANY, LOCATIONS, EMAIL_TEMPLATES } from '@/lib/constants';
import { LoadingSpinner } from './LoadingSpinner';
import { SearchableCombobox } from './SearchableCombobox';
import { getTemplatesAction, TemplateData } from '@/app/actions/profile';
import { CreditsDisplay } from '@/components/credits';


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

  const [company, setCompany] = useState<string>(initialParams?.company || '');
  const [role, setRole] = useState<string>(initialParams?.role || '');

  // Get roles for the selected company, fall back to generic roles list
  const availableRoles = company
    ? (ROLES_BY_COMPANY[company] || [...ROLES])
    : [...ROLES];
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
      <h2 className="text-xl font-bold text-surface-900 mb-4">Find People</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-5 mb-6">
        {/* Company */}
        <div className="lg:col-span-2">
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
        <div className="lg:col-span-2">
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
        <div className="lg:col-span-2">
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
        <div className="lg:col-span-3">
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

        {/* Template */}
        <div className="lg:col-span-3">
          <SearchableCombobox
            options={
              isLoadingTemplates
                ? [{ label: 'Loading templates...', value: '' }]
                : templates.length === 0
                ? [{ label: EMAIL_TEMPLATES[0].name, value: EMAIL_TEMPLATES[0].id }]
                : templates.map((t) => ({
                    label: t.name + (t.isDefault ? ' (Default)' : ''),
                    value: t.id,
                  }))
            }
            value={templateId}
            onChange={setTemplateId}
            label="Email Template"
            placeholder="Select a template..."
            id="template"
            disabled={isLoadingTemplates}
          />
          {templateError && <p className="mt-1.5 text-sm text-amber-600">{templateError}</p>}
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
