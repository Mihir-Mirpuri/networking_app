'use client';

import { useState, useEffect } from 'react';
import { SearchForm } from './SearchForm';
import { ResultsList } from './ResultsList';
import { ExpandedReview } from './ExpandedReview';
import { PastEmailsSidebar } from '../sidebar/PastEmailsSidebar';
import { searchPeopleAction, SearchResultWithDraft, hidePersonAction } from '@/app/actions/search';
import { sendSingleEmailAction, sendEmailsAction, PersonToSend } from '@/app/actions/send';
import { getDefaultTemplateAction, updateDefaultTemplateAction } from '@/app/actions/jobs';
import type { TemplatePrompt } from '@/lib/types/email';

interface SearchPageClientProps {
  initialRemainingDaily: number;
}

export function SearchPageClient({ initialRemainingDaily }: SearchPageClientProps) {
  const [results, setResults] = useState<SearchResultWithDraft[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendingIndex, setSendingIndex] = useState<number | undefined>();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sendStatuses, setSendStatuses] = useState<Map<string, 'success' | 'failed' | 'pending'>>(
    new Map()
  );
  const [remainingDaily, setRemainingDaily] = useState(initialRemainingDaily);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateExpanded, setTemplateExpanded] = useState(false);
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  // Load template when component mounts
  useEffect(() => {
    const loadTemplate = async () => {
      setIsLoadingTemplate(true);
      try {
        const templateResult = await getDefaultTemplateAction();
        if (templateResult.success) {
          setTemplateSubject(templateResult.template.subject);
          setTemplateBody(templateResult.template.body);
        }
      } catch (error) {
        console.error('Error loading template:', error);
      } finally {
        setIsLoadingTemplate(false);
      }
    };
    loadTemplate();
  }, []);

  const handleSaveTemplate = async () => {
    if (!templateSubject.trim() || !templateBody.trim()) {
      setError('Template subject and body are required');
      return;
    }

    setIsSavingTemplate(true);
    setTemplateSaved(false);

    try {
      const template: TemplatePrompt = {
        subject: templateSubject.trim(),
        body: templateBody.trim(),
      };

      const result = await updateDefaultTemplateAction(template);
      if (result.success) {
        setTemplateSaved(true);
        setTimeout(() => setTemplateSaved(false), 3000);
      } else {
        setError(result.error || 'Failed to save template');
      }
    } catch (error) {
      console.error('Error saving template:', error);
      setError(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleSearch = async (params: {
    company: string;
    role: string;
    university: string;
    limit: number;
    templateId: string;
  }) => {
    setIsSearching(true);
    setError(null);
    setResults([]);
    setSendStatuses(new Map());


    const result = await searchPeopleAction(params);

    if (result.success) {
      setResults(result.results);
    } else {
      setError(result.error);
    }

    setIsSearching(false);
  };


  const handleSendSingle = async (index: number) => {
    const person = results[index];
    if (!person.email || !person.userCandidateId) return;

    setSendingIndex(index);
    setIsSending(true);
    setSendStatuses((prev) => new Map(prev).set(person.id, 'pending'));

    const personToSend: PersonToSend = {
      email: person.email,
      subject: person.draftSubject,
      body: person.draftBody,
      userCandidateId: person.userCandidateId,
    };

    const result = await sendSingleEmailAction(personToSend);

    setSendStatuses((prev) =>
      new Map(prev).set(person.id, result.success ? 'success' : 'failed')
    );

    if (result.success) {
      setRemainingDaily((prev) => Math.max(0, prev - 1));
    }

    setIsSending(false);
    setSendingIndex(undefined);
  };

  const handleSendFromReview = async (index: number, subject: string, body: string) => {
    const person = results[index];
    if (!person.email || !person.userCandidateId) return;

    setSendStatuses((prev) => new Map(prev).set(person.id, 'pending'));

    const personToSend: PersonToSend = {
      email: person.email,
      subject,
      body,
      userCandidateId: person.userCandidateId,
    };

    const result = await sendSingleEmailAction(personToSend);

    setSendStatuses((prev) =>
      new Map(prev).set(person.id, result.success ? 'success' : 'failed')
    );

    if (result.success) {
      setRemainingDaily((prev) => Math.max(0, prev - 1));
    }
  };

  const handleSendAll = async () => {
    const peopleToSend = results
      .filter((r) => r.email && r.userCandidateId && !sendStatuses.has(r.id))
      .map((person) => ({
        email: person.email!,
        subject: person.draftSubject,
        body: person.draftBody,
        userCandidateId: person.userCandidateId!,
      }));

    if (peopleToSend.length === 0) return;

    setIsSending(true);

    // Mark all as pending
    const newStatuses = new Map(sendStatuses);
    results.forEach((r) => {
      if (r.email && r.userCandidateId && !sendStatuses.has(r.id)) {
        newStatuses.set(r.id, 'pending');
      }
    });
    setSendStatuses(newStatuses);

    const result = await sendEmailsAction(peopleToSend);

    if (result.success) {
      // Update statuses based on results
      const updatedStatuses = new Map(newStatuses);
      result.results.forEach((res) => {
        const person = results.find((r) => r.email === res.email);
        if (person) {
          updatedStatuses.set(person.id, res.success ? 'success' : 'failed');
        }
      });
      setSendStatuses(updatedStatuses);

      const successCount = result.results.filter((r) => r.success).length;
      setRemainingDaily((prev) => Math.max(0, prev - successCount));
    }

    setIsSending(false);
  };

  const handleHidePerson = async (userCandidateId: string) => {
    const result = await hidePersonAction(userCandidateId);
    
    if (result.success) {
      // Remove person from results immediately
      setResults((prev) => prev.filter((r) => r.userCandidateId !== userCandidateId));
    } else {
      setError(result.error || 'Failed to hide person');
    }
  };

  return (
    <div className="relative">
      <SearchForm onSearch={handleSearch} isLoading={isSearching} />

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Template Editing Section - shown when results are displayed */}
      {results.length > 0 && expandedIndex === null && (
        <div className="mb-6 bg-white rounded-lg shadow p-4">
          <button
            onClick={() => setTemplateExpanded(!templateExpanded)}
            className="w-full flex items-center justify-between hover:bg-gray-50 p-2 rounded"
          >
            <span className="font-medium text-gray-700">Email Template</span>
            <svg
              className={`w-5 h-5 transition-transform ${templateExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {templateExpanded && (
            <div className="mt-4 space-y-4">
              {templateSaved && (
                <div className="px-4 py-2 bg-green-100 text-green-800 rounded">
                  Template saved successfully!
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Subject
                  <span className="text-xs text-gray-500 ml-2">
                    (Use placeholders: {'{first_name}'}, {'{company}'}, {'{university}'}, {'{role}'})
                  </span>
                </label>
                <textarea
                  value={templateSubject}
                  onChange={(e) => setTemplateSubject(e.target.value)}
                  rows={2}
                  disabled={isLoadingTemplate || isSavingTemplate}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Reaching out from {university}"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Body
                  <span className="text-xs text-gray-500 ml-2">
                    (Use placeholders: {'{first_name}'}, {'{company}'}, {'{university}'}, {'{role}'})
                  </span>
                </label>
                <textarea
                  value={templateBody}
                  onChange={(e) => setTemplateBody(e.target.value)}
                  rows={6}
                  disabled={isLoadingTemplate || isSavingTemplate}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Hi {first_name},&#10;&#10;I'm a student at {university}..."
                />
              </div>
              <button
                onClick={handleSaveTemplate}
                disabled={isSavingTemplate || isLoadingTemplate}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingTemplate ? 'Saving...' : 'Save as Default Template'}
              </button>
            </div>
          )}
        </div>
      )}

      {results.length > 0 && expandedIndex === null && (
        <ResultsList
          results={results}
          onSendAll={handleSendAll}
          onSendSingle={handleSendSingle}
          onExpand={setExpandedIndex}
          onHide={handleHidePerson}
          isSending={isSending}
          sendingIndex={sendingIndex}
          sendStatuses={sendStatuses}
          remainingDaily={remainingDaily}
        />
      )}

      {expandedIndex !== null && (
        <ExpandedReview
          results={results}
          currentIndex={expandedIndex}
          onClose={() => setExpandedIndex(null)}
          onSend={handleSendFromReview}
          sendStatuses={sendStatuses}
        />
      )}

      <PastEmailsSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
    </div>
  );
}
