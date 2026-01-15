'use client';

import { Campaign } from '@prisma/client';
import { useState } from 'react';
import { updateCampaignTemplate } from '@/app/actions/campaign';
import { useRouter } from 'next/navigation';

interface TemplateEditorProps {
  campaign: Campaign;
}

export function TemplateEditor({ campaign }: TemplateEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [subject, setSubject] = useState(campaign.templateSubject);
  const [body, setBody] = useState(campaign.templateBody);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateCampaignTemplate(campaign.id, subject, body);
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save template:', error);
      alert('Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Email Template</h2>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          {isOpen ? 'Close' : 'Edit Template'}
        </button>
      </div>

      {isOpen ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Available tokens: {'{first_name}'}, {'{company}'}, {'{school}'}, {'{full_name}'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save & Regenerate Drafts'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">
            Subject: {campaign.templateSubject}
          </p>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">
            {campaign.templateBody}
          </p>
        </div>
      )}
    </div>
  );
}
