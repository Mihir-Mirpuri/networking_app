/**
 * Types for AI Email Drafter service
 */

export type DrafterPhase = 'template_selection' | 'gap_filling' | 'drafting' | 'refinement';

export type TemplateSource = 'custom' | 'preset';

export interface RecipientContext {
  name?: string;
  firstName?: string;
  company?: string;
  role?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface DrafterSession {
  phase: DrafterPhase;
  template: string | null;
  templateSource: TemplateSource | null;
  recipientContext: RecipientContext;
  userAnswers: Record<string, string>;
  currentDraft: EmailDraft | null;
  messages: ChatMessage[];
  isProcessing: boolean;
}

export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  icon: 'briefcase' | 'users' | 'coffee';
  template: string;
}

// Gap analysis types
export interface IdentifiedGap {
  key: string;
  question: string;
  isRequired: boolean;
}

export interface GapAnalysisResult {
  gaps: IdentifiedGap[];
  nextQuestion: string | null;
  isComplete: boolean;
}

export interface GapResponseResult {
  extractedAnswer: string;
  nextQuestion: string | null;
  isComplete: boolean;
  updatedAnswers: Record<string, string>;
}

// Draft generation types
export interface DraftGenerationInput {
  template: string;
  recipientContext: RecipientContext;
  userAnswers: Record<string, string>;
  userInstructions?: string;
}

export interface DraftGenerationResult {
  subject: string;
  body: string;
}

// Refinement types
export interface RefinementInput {
  currentDraft: EmailDraft;
  userMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  recipientContext: RecipientContext;
}

export interface RefinementResult {
  subject: string;
  body: string;
  assistantMessage: string;
}
