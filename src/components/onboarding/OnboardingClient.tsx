'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchableCombobox } from '@/components/search/SearchableCombobox';
import { UNIVERSITIES, CLASSIFICATIONS } from '@/lib/constants';
import { completeOnboardingAction, OnboardingData } from '@/app/actions/onboarding';

interface OnboardingClientProps {
  userName: string | null;
}

export function OnboardingClient({ userName }: OnboardingClientProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<OnboardingData>({
    name: userName || '',
    classification: '',
    major: '',
    university: '',
    career: '',
  });

  const isFormValid =
    formData.name.trim() &&
    formData.classification.trim() &&
    formData.major.trim() &&
    formData.university.trim() &&
    formData.career.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const result = await completeOnboardingAction(formData);

    if (result.success) {
      router.push('/');
    } else {
      setError(result.error);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-surface-900 mb-2">
            Welcome to Signl
          </h1>
          <p className="text-surface-600">
            Let's set up your profile so your outreach emails are personalized.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6">
          {error && (
            <div className="mb-6 px-4 py-3 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input"
                placeholder="Your full name"
                required
              />
            </div>

            <div>
              <label htmlFor="classification" className="block text-sm font-medium text-surface-700 mb-1.5">
                Classification <span className="text-red-500">*</span>
              </label>
              <select
                id="classification"
                value={formData.classification}
                onChange={(e) => setFormData({ ...formData, classification: e.target.value })}
                className="input"
                required
              >
                <option value="">Select classification</option>
                {CLASSIFICATIONS.map((classification) => (
                  <option key={classification} value={classification}>
                    {classification}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">
                Major <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.major}
                onChange={(e) => setFormData({ ...formData, major: e.target.value })}
                className="input"
                placeholder="e.g., Computer Science, Finance"
                required
              />
            </div>

            <SearchableCombobox
              options={UNIVERSITIES}
              value={formData.university}
              onChange={(value) => setFormData({ ...formData, university: value })}
              label="University"
              placeholder="Search universities..."
              id="university"
            />

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-surface-700 mb-1.5">
                Career Interest <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.career}
                onChange={(e) => setFormData({ ...formData, career: e.target.value })}
                className="input"
                placeholder="e.g., Investment Banking, Consulting"
                required
              />
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-surface-200">
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="btn-primary w-full"
            >
              {isSubmitting ? 'Saving...' : 'Complete Setup'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
