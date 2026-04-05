'use client';

import { useState } from 'react';
import { PRESET_TEMPLATES } from '@/lib/services/drafter';
import { TemplateCard } from './TemplateCard';
import { useDrafter } from '@/contexts/DrafterContext';

export function TemplateSelector() {
  const { selectTemplate, isProcessing } = useDrafter();
  const [customTemplate, setCustomTemplate] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const handlePresetSelect = (template: (typeof PRESET_TEMPLATES)[number]) => {
    selectTemplate(template.template, 'preset');
  };

  const handleCustomSubmit = () => {
    if (customTemplate.trim()) {
      selectTemplate(customTemplate.trim(), 'custom');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-sm font-medium text-white mb-1">
          Draft an Email
        </h2>
        <p className="text-xs text-white">
          Choose a template or paste your own
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {!showCustomInput ? (
          <>
            {/* Preset templates */}
            <div className="space-y-2 mb-4">
              {PRESET_TEMPLATES.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onClick={() => handlePresetSelect(template)}
                  disabled={isProcessing}
                />
              ))}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-[#303030]" />
              <span className="text-xs text-white">or</span>
              <div className="flex-1 h-px bg-[#303030]" />
            </div>

            {/* Custom template button */}
            <button
              onClick={() => setShowCustomInput(true)}
              disabled={isProcessing}
              className="w-full p-3 text-center text-sm text-white border border-dashed border-[#303030] rounded-lg hover:border-[#404040] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Paste your own template
            </button>
          </>
        ) : (
          <>
            {/* Custom template input */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white">Your template</span>
                <button
                  onClick={() => {
                    setShowCustomInput(false);
                    setCustomTemplate('');
                  }}
                  className="text-xs text-white hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>

              <textarea
                value={customTemplate}
                onChange={(e) => setCustomTemplate(e.target.value)}
                placeholder="Paste your email template here...

You can use {{placeholders}} for information you want filled in, like:

Hi {{recruiter_name}},

I'm interested in {{role}} at {{company}}..."
                disabled={isProcessing}
                className="w-full h-64 px-3 py-2.5 text-sm bg-[#1a1a1a] border border-[#303030] rounded-lg text-white placeholder:text-[#404040] focus:outline-none focus:border-[#404040] disabled:opacity-50 disabled:cursor-not-allowed resize-none"
              />

              <button
                onClick={handleCustomSubmit}
                disabled={!customTemplate.trim() || isProcessing}
                className="w-full py-2.5 text-sm font-medium bg-[#303030] text-white rounded-lg hover:bg-[#404040] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Processing...' : 'Use this template'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
