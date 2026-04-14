/**
 * AI Email Drafter Service
 *
 * Usage:
 *   import { analyzeTemplateGaps, generateDraft, refineDraft } from '@/lib/services/drafter';
 *   import { PRESET_TEMPLATES, getTemplateById } from '@/lib/services/drafter';
 */

// Types
export type {
  DrafterPhase,
  TemplateSource,
  RecipientContext,
  ChatMessage,
  EmailDraft,
  DrafterSession,
  PresetTemplate,
  IdentifiedGap,
  GapAnalysisResult,
  GapResponseResult,
  DraftGenerationInput,
  DraftGenerationResult,
  RefinementInput,
  RefinementResult,
} from './types';

// Templates
export { PRESET_TEMPLATES, getTemplateById } from './templates';

// NOTE: LLM-dependent functions (analyzeTemplateGaps, processGapResponse,
// generateDraft, refineDraft, extractPlaceholders) are server-only because they
// import the Anthropic client which uses Node.js APIs. Import them directly:
//   import { analyzeTemplateGaps, processGapResponse, extractPlaceholders } from '@/lib/services/drafter/gap-analysis';
//   import { generateDraft, refineDraft } from '@/lib/services/drafter/draft-generation';
