'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import {
  analyzeTemplateGapsAction,
  processGapResponseAction,
  generateDraftAction,
  refineDraftAction,
} from '@/app/actions/drafter';
import {
  DrafterPhase,
  TemplateSource,
  RecipientContext,
  IdentifiedGap,
  EmailDraft,
} from '@/lib/services/drafter';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface DrafterContextValue {
  // State
  isOpen: boolean;
  phase: DrafterPhase;
  template: string | null;
  templateSource: TemplateSource | null;
  recipientContext: RecipientContext;
  userAnswers: Record<string, string>;
  currentDraft: EmailDraft | null;
  messages: ChatMessage[];
  isProcessing: boolean;

  // Identified gaps (internal tracking)
  gaps: IdentifiedGap[];
  currentGapIndex: number;

  // Actions
  openDrafter: (recipientContext?: RecipientContext) => void;
  closeDrafter: () => void;
  selectTemplate: (template: string, source: TemplateSource) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  copyDraft: () => void;
  resetSession: () => void;
}

const DrafterContext = createContext<DrafterContextValue | null>(null);

export function useDrafter() {
  const context = useContext(DrafterContext);
  if (!context) {
    throw new Error('useDrafter must be used within a DrafterProvider');
  }
  return context;
}

interface DrafterProviderProps {
  children: ReactNode;
}

export function DrafterProvider({ children }: DrafterProviderProps) {
  // Core state
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<DrafterPhase>('template_selection');
  const [template, setTemplate] = useState<string | null>(null);
  const [templateSource, setTemplateSource] = useState<TemplateSource | null>(null);
  const [recipientContext, setRecipientContext] = useState<RecipientContext>({});
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Gap tracking
  const [gaps, setGaps] = useState<IdentifiedGap[]>([]);
  const [currentGapIndex, setCurrentGapIndex] = useState(0);

  const addAssistantMessage = useCallback((content: string) => {
    const message: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, message]);
  }, []);

  const addUserMessage = useCallback((content: string) => {
    const message: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, message]);
  }, []);

  const openDrafter = useCallback((context?: RecipientContext) => {
    setIsOpen(true);
    setPhase('template_selection');
    setTemplate(null);
    setTemplateSource(null);
    setRecipientContext(context || {});
    setUserAnswers({});
    setCurrentDraft(null);
    setMessages([]);
    setGaps([]);
    setCurrentGapIndex(0);
    setIsProcessing(false);
  }, []);

  const closeDrafter = useCallback(() => {
    setIsOpen(false);
  }, []);

  const resetSession = useCallback(() => {
    setPhase('template_selection');
    setTemplate(null);
    setTemplateSource(null);
    setUserAnswers({});
    setCurrentDraft(null);
    setMessages([]);
    setGaps([]);
    setCurrentGapIndex(0);
    setIsProcessing(false);
  }, []);

  const selectTemplate = useCallback(
    async (selectedTemplate: string, source: TemplateSource) => {
      setTemplate(selectedTemplate);
      setTemplateSource(source);
      setIsProcessing(true);

      try {
        const result = await analyzeTemplateGapsAction({
          template: selectedTemplate,
          recipientContext,
        });

        if (result.success) {
          if (result.isComplete) {
            // No gaps to fill, go directly to drafting
            setPhase('drafting');
            addAssistantMessage('Got it! Generating your email draft...');

            // Generate draft immediately
            const draftResult = await generateDraftAction({
              template: selectedTemplate,
              recipientContext,
              userAnswers: {},
            });

            if (draftResult.success) {
              setCurrentDraft({
                subject: draftResult.subject,
                body: draftResult.body,
              });
              setPhase('refinement');
              addAssistantMessage(
                'Here\'s your draft! Let me know if you\'d like any changes.'
              );
            } else {
              addAssistantMessage(
                'Sorry, I had trouble generating the draft. Please try again.'
              );
            }
          } else {
            // Has gaps to fill
            setGaps(result.gaps);
            setCurrentGapIndex(0);
            setPhase('gap_filling');
            if (result.nextQuestion) {
              addAssistantMessage(result.nextQuestion);
            }
          }
        } else {
          addAssistantMessage(
            'Sorry, I had trouble analyzing that template. Please try again.'
          );
          setPhase('template_selection');
        }
      } catch (error) {
        console.error('Error selecting template:', error);
        addAssistantMessage('Something went wrong. Please try again.');
        setPhase('template_selection');
      } finally {
        setIsProcessing(false);
      }
    },
    [recipientContext, addAssistantMessage]
  );

  const handleGapResponse = useCallback(
    async (userResponse: string) => {
      if (!template || gaps.length === 0) return;

      const currentGap = gaps[currentGapIndex];
      const remainingGaps = gaps.slice(currentGapIndex + 1);

      const result = await processGapResponseAction({
        userResponse,
        currentGapKey: currentGap?.key || 'general',
        remainingGaps,
        answeredGaps: userAnswers,
      });

      if (result.success) {
        setUserAnswers(result.updatedAnswers);

        if (result.isComplete) {
          // All gaps filled, generate draft
          setPhase('drafting');
          addAssistantMessage('Perfect! Generating your email now...');

          const draftResult = await generateDraftAction({
            template,
            recipientContext,
            userAnswers: result.updatedAnswers,
          });

          if (draftResult.success) {
            setCurrentDraft({
              subject: draftResult.subject,
              body: draftResult.body,
            });
            setPhase('refinement');
            addAssistantMessage(
              'Here\'s your draft! Let me know if you\'d like any changes.'
            );
          } else {
            addAssistantMessage(
              'Sorry, I had trouble generating the draft. Please try again.'
            );
          }
        } else if (result.nextQuestion) {
          // More questions to ask
          setCurrentGapIndex((prev) => prev + 1);
          addAssistantMessage(result.nextQuestion);
        }
      } else {
        addAssistantMessage(
          'I had trouble understanding that. Could you rephrase?'
        );
      }
    },
    [template, gaps, currentGapIndex, userAnswers, recipientContext, addAssistantMessage]
  );

  const handleRefinement = useCallback(
    async (userMessage: string) => {
      if (!currentDraft) return;

      // Get recent conversation history for context
      const recentMessages = messages.slice(-6);
      const conversationHistory = recentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await refineDraftAction({
        currentDraft,
        userMessage,
        conversationHistory,
        recipientContext,
      });

      if (result.success) {
        setCurrentDraft({
          subject: result.subject,
          body: result.body,
        });
        addAssistantMessage(result.assistantMessage);
      } else {
        addAssistantMessage(
          'Sorry, I had trouble with that change. Please try again.'
        );
      }
    },
    [currentDraft, messages, recipientContext, addAssistantMessage]
  );

  const sendMessage = useCallback(
    async (message: string) => {
      if (isProcessing) return;

      addUserMessage(message);
      setIsProcessing(true);

      try {
        if (phase === 'gap_filling') {
          await handleGapResponse(message);
        } else if (phase === 'refinement') {
          await handleRefinement(message);
        }
      } catch (error) {
        console.error('Error processing message:', error);
        addAssistantMessage('Something went wrong. Please try again.');
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, phase, addUserMessage, handleGapResponse, handleRefinement, addAssistantMessage]
  );

  const copyDraft = useCallback(() => {
    if (!currentDraft) return;

    const textToCopy = `Subject: ${currentDraft.subject}\n\n${currentDraft.body}`;
    navigator.clipboard.writeText(textToCopy);
  }, [currentDraft]);

  // Limit messages to last 20 for memory efficiency
  const limitedMessages = messages.slice(-20);

  return (
    <DrafterContext.Provider
      value={{
        isOpen,
        phase,
        template,
        templateSource,
        recipientContext,
        userAnswers,
        currentDraft,
        messages: limitedMessages,
        isProcessing,
        gaps,
        currentGapIndex,
        openDrafter,
        closeDrafter,
        selectTemplate,
        sendMessage,
        copyDraft,
        resetSession,
      }}
    >
      {children}
    </DrafterContext.Provider>
  );
}
