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

// Gap analysis functions
export {
  analyzeTemplateGaps,
  processGapResponse,
  extractPlaceholders,
} from './gap-analysis';

// Draft generation functions
export { generateDraft, refineDraft } from './draft-generation';
