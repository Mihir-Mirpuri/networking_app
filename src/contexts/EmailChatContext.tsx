'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { refineEmailConversationalAction } from '@/app/actions/email-chat';
import { getPersonInsightsAction, PersonInsightResponse } from '@/app/actions/person-insights';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface EmailChatContextValue {
  isEmailReviewOpen: boolean;
  currentPersonId: string | null;
  currentPersonName: string | null;
  currentEmail: { subject: string; body: string } | null;
  messages: ChatMessage[];
  isProcessing: boolean;

  // Insights
  insights: PersonInsightResponse[];
  selectedInsightIds: Set<string>;
  insightsLoading: boolean;
  insightsError: string | null;

  openEmailChat: (personId: string, personName: string, subject: string, body: string) => void;
  closeEmailChat: () => void;
  sendMessage: (message: string) => Promise<void>;
  updateEmail: (subject: string, body: string) => void;
  fetchInsights: (personId: string) => Promise<void>;
  toggleInsight: (insightId: string) => void;
}

const EmailChatContext = createContext<EmailChatContextValue | null>(null);

export function useEmailChat() {
  const context = useContext(EmailChatContext);
  if (!context) {
    throw new Error('useEmailChat must be used within an EmailChatProvider');
  }
  return context;
}

interface EmailChatProviderProps {
  children: ReactNode;
}

export function EmailChatProvider({ children }: EmailChatProviderProps) {
  const [isEmailReviewOpen, setIsEmailReviewOpen] = useState(false);
  const [currentPersonId, setCurrentPersonId] = useState<string | null>(null);
  const [currentPersonName, setCurrentPersonName] = useState<string | null>(null);
  const [currentEmail, setCurrentEmail] = useState<{ subject: string; body: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Insights state
  const [insights, setInsights] = useState<PersonInsightResponse[]>([]);
  const [selectedInsightIds, setSelectedInsightIds] = useState<Set<string>>(new Set());
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const fetchInsights = useCallback(async (personId: string) => {
    // Reset previous insights immediately so stale data doesn't linger
    setInsights([]);
    setSelectedInsightIds(new Set());
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const result = await getPersonInsightsAction(personId);
      if (result.success) {
        setInsights(result.insights);
      } else {
        setInsightsError(result.error || 'Failed to load insights');
        setInsights([]);
      }
    } catch (err) {
      console.error('[EmailChat] Failed to fetch insights:', err);
      setInsightsError('Failed to load insights');
      setInsights([]);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  const toggleInsight = useCallback((insightId: string) => {
    setSelectedInsightIds(prev => {
      const next = new Set(prev);
      if (next.has(insightId)) {
        next.delete(insightId);
      } else {
        next.add(insightId);
      }
      return next;
    });
  }, []);

  const openEmailChat = useCallback((personId: string, personName: string, subject: string, body: string) => {
    setIsEmailReviewOpen(true);
    setCurrentPersonId((prev) => {
      if (prev !== personId) {
        // New person — reset chat history only (insights are managed by fetchInsights)
        setMessages([]);
      }
      return personId;
    });
    setCurrentPersonName(personName);
    setCurrentEmail({ subject, body });
  }, []);

  const closeEmailChat = useCallback(() => {
    setIsEmailReviewOpen(false);
    setCurrentPersonId(null);
    setCurrentPersonName(null);
    setCurrentEmail(null);
    setMessages([]);
    setInsights([]);
    setSelectedInsightIds(new Set());
    setInsightsError(null);
  }, []);

  const updateEmail = useCallback((subject: string, body: string) => {
    setCurrentEmail({ subject, body });
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!currentEmail || !currentPersonId || isProcessing) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsProcessing(true);

    try {
      // Get last 6 turns for context (3 user + 3 assistant)
      const recentMessages = messages.slice(-6);
      const conversationHistory = recentMessages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Build selected insights to pass to the server action
      const selectedInsights = selectedInsightIds.size > 0
        ? insights
            .filter(i => selectedInsightIds.has(i.id))
            .map(i => ({ label: i.label, detail: i.detail, type: i.type }))
        : undefined;

      const result = await refineEmailConversationalAction({
        subject: currentEmail.subject,
        body: currentEmail.body,
        userMessage: content,
        conversationHistory,
        personId: currentPersonId,
        selectedInsights,
      });

      if (result.success) {
        // Update email
        setCurrentEmail({
          subject: result.subject,
          body: result.body,
        });

        // Add assistant message
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.assistantMessage,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        // Add error message
        const errorMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.error || 'Sorry, I had trouble processing that. Please try again.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('Email chat error:', error);
      const errorMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  }, [currentEmail, currentPersonId, messages, isProcessing, insights, selectedInsightIds]);

  // Limit messages to last 10 for memory efficiency
  const limitedMessages = messages.slice(-10);

  return (
    <EmailChatContext.Provider
      value={{
        isEmailReviewOpen,
        currentPersonId,
        currentPersonName,
        currentEmail,
        messages: limitedMessages,
        isProcessing,
        insights,
        selectedInsightIds,
        insightsLoading,
        insightsError,
        openEmailChat,
        closeEmailChat,
        sendMessage,
        updateEmail,
        fetchInsights,
        toggleInsight,
      }}
    >
      {children}
    </EmailChatContext.Provider>
  );
}
