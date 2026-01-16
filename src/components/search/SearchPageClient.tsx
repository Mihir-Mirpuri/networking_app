'use client';

import { useState } from 'react';
import { SearchForm } from './SearchForm';
import { ResultsList } from './ResultsList';
import { ExpandedReview } from './ExpandedReview';
import { PastEmailsSidebar } from '../sidebar/PastEmailsSidebar';
import { searchPeopleAction, SearchResultWithDraft } from '@/app/actions/search';
import { sendSingleEmailAction, sendEmailsAction, PersonToSend } from '@/app/actions/send';

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
    if (!person.email) return;

    setSendingIndex(index);
    setIsSending(true);
    setSendStatuses((prev) => new Map(prev).set(person.id, 'pending'));

    const personToSend: PersonToSend = {
      fullName: person.fullName,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      company: person.company,
      role: person.role,
      university: person.university,
      subject: person.draftSubject,
      body: person.draftBody,
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
    if (!person.email) return;

    setSendStatuses((prev) => new Map(prev).set(person.id, 'pending'));

    const personToSend: PersonToSend = {
      fullName: person.fullName,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      company: person.company,
      role: person.role,
      university: person.university,
      subject,
      body,
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
      .filter((r) => r.email && !sendStatuses.has(r.id))
      .map((person) => ({
        fullName: person.fullName,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email!,
        company: person.company,
        role: person.role,
        university: person.university,
        subject: person.draftSubject,
        body: person.draftBody,
      }));

    if (peopleToSend.length === 0) return;

    setIsSending(true);

    // Mark all as pending
    const newStatuses = new Map(sendStatuses);
    results.forEach((r) => {
      if (r.email && !sendStatuses.has(r.id)) {
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

  return (
    <div className="relative">
      <SearchForm onSearch={handleSearch} isLoading={isSearching} />

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {results.length > 0 && expandedIndex === null && (
        <ResultsList
          results={results}
          onSendAll={handleSendAll}
          onSendSingle={handleSendSingle}
          onExpand={setExpandedIndex}
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
