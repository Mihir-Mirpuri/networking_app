'use client';

import { useEffect, useRef } from 'react';
import { signIn } from 'next-auth/react';
import './landing.css';

export function LandingPage() {
  const userMessageRef = useRef<HTMLDivElement>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);
  const loadingStateRef = useRef<HTMLDivElement>(null);
  const loadMoreBtnRef = useRef<HTMLButtonElement>(null);
  const composeOverlayRef = useRef<HTMLDivElement>(null);
  const sendBtnRef = useRef<HTMLButtonElement>(null);
  const sendTextRef = useRef<HTMLSpanElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const activeTimeouts = useRef<NodeJS.Timeout[]>([]);
  const typingTimeout = useRef<NodeJS.Timeout | null>(null);

  const handleGetStarted = () => {
    signIn('google', { callbackUrl: '/app' });
  };

  useEffect(() => {
    const TIMELINE = {
      USER_TYPE_START: 500,
      AI_TYPING_START: 3200,
      AI_RESPONSE: 4000,
      LOADING_START: 4200,
      LOADING_END: 5800,
      CARDS_START: 5900,
      CARD_DELAY: 100,
      LOAD_MORE_SHOW: 6800,
      SELECT_CARD: 7800,
      COMPOSE_OPEN: 8600,
      EMAIL_LINE_DELAY: 250,
      SEND_START: 11500,
      SEND_COMPLETE: 12200,
      LOOP_DURATION: 14000
    };

    const searchQuery = "Find me PMs at Stripe who went to UT Austin and work in New York";

    function scheduleTimeout(callback: () => void, delay: number) {
      const id = setTimeout(callback, delay);
      activeTimeouts.current.push(id);
      return id;
    }

    function clearAllTimeouts() {
      activeTimeouts.current.forEach(id => clearTimeout(id));
      activeTimeouts.current = [];
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
        typingTimeout.current = null;
      }
    }

    function typeText(element: HTMLElement, text: string, callback?: () => void) {
      let index = 0;
      element.classList.add('visible');
      element.textContent = '';

      function type() {
        if (index < text.length) {
          element.textContent = text.substring(0, index + 1);
          index++;
          typingTimeout.current = setTimeout(type, 45);
        } else if (callback) {
          callback();
        }
      }
      type();
    }

    function resetAnimation() {
      clearAllTimeouts();

      if (userMessageRef.current) {
        userMessageRef.current.classList.remove('visible');
        userMessageRef.current.textContent = '';
      }
      if (aiResponseRef.current) {
        aiResponseRef.current.classList.remove('visible');
        aiResponseRef.current.textContent = '';
      }
      if (loadingStateRef.current) {
        loadingStateRef.current.classList.remove('visible');
      }
      if (loadMoreBtnRef.current) {
        loadMoreBtnRef.current.classList.remove('visible');
      }
      cardRefs.current.forEach(card => {
        card?.classList.remove('visible', 'selected');
      });
      if (composeOverlayRef.current) {
        composeOverlayRef.current.classList.remove('visible');
      }
      lineRefs.current.forEach(line => {
        line?.classList.remove('visible');
      });
      if (sendBtnRef.current) {
        sendBtnRef.current.classList.remove('sending', 'sent');
      }
      if (sendTextRef.current) {
        sendTextRef.current.textContent = 'Send';
      }
    }

    function runAnimation() {
      resetAnimation();

      // Phase 1: User types query
      scheduleTimeout(() => {
        if (userMessageRef.current) {
          typeText(userMessageRef.current, searchQuery);
        }
      }, TIMELINE.USER_TYPE_START);

      // Phase 2: AI Response
      scheduleTimeout(() => {
        if (aiResponseRef.current) {
          aiResponseRef.current.textContent = 'Searching for PMs at Stripe from UT Austin in New York!';
          aiResponseRef.current.classList.add('visible');
        }
      }, TIMELINE.AI_RESPONSE);

      // Phase 4: Show loading
      scheduleTimeout(() => {
        loadingStateRef.current?.classList.add('visible');
      }, TIMELINE.LOADING_START);

      // Phase 5: Hide loading, show results
      scheduleTimeout(() => {
        loadingStateRef.current?.classList.remove('visible');
      }, TIMELINE.LOADING_END);

      // Phase 6: Staggered card reveal
      cardRefs.current.forEach((card, index) => {
        scheduleTimeout(() => {
          card?.classList.add('visible');
        }, TIMELINE.CARDS_START + (index * TIMELINE.CARD_DELAY));
      });

      // Phase 7: Show load more button
      scheduleTimeout(() => {
        loadMoreBtnRef.current?.classList.add('visible');
      }, TIMELINE.LOAD_MORE_SHOW);

      // Phase 8: Select card 5 (Jennifer L.)
      scheduleTimeout(() => {
        cardRefs.current[4]?.classList.add('selected');
      }, TIMELINE.SELECT_CARD);

      // Phase 9: Open compose modal
      scheduleTimeout(() => {
        composeOverlayRef.current?.classList.add('visible');
      }, TIMELINE.COMPOSE_OPEN);

      // Phase 10: Type email lines
      lineRefs.current.forEach((line, index) => {
        scheduleTimeout(() => {
          line?.classList.add('visible');
        }, TIMELINE.COMPOSE_OPEN + 400 + (index * TIMELINE.EMAIL_LINE_DELAY));
      });

      // Phase 11: Send button animation
      scheduleTimeout(() => {
        sendBtnRef.current?.classList.add('sending');
        if (sendTextRef.current) sendTextRef.current.textContent = 'Sending...';
      }, TIMELINE.SEND_START);

      scheduleTimeout(() => {
        sendBtnRef.current?.classList.remove('sending');
        sendBtnRef.current?.classList.add('sent');
        if (sendTextRef.current) sendTextRef.current.textContent = 'Sent!';
      }, TIMELINE.SEND_COMPLETE);

      // Loop
      scheduleTimeout(runAnimation, TIMELINE.LOOP_DURATION);
    }

    const startTimeout = setTimeout(runAnimation, 500);

    return () => {
      clearTimeout(startTimeout);
      clearAllTimeouts();
    };
  }, []);

  const people = [
    { initials: 'PS', name: 'Patrick S.', color: 'coral' },
    { initials: 'AF', name: 'Auryana F.', color: 'teal' },
    { initials: 'NR', name: 'Nilofer R.', color: 'coral' },
    { initials: 'CG', name: 'Christina G.', color: 'emerald' },
    { initials: 'JL', name: 'Jennifer L.', color: 'teal' },
    { initials: 'DY', name: 'Dianna Y.', color: 'purple' },
  ];

  return (
    <section className="landing-hero">
        {/* Animated Wave Background */}
        <div className="wave-container">
          <div className="wave-ring"></div>
          <div className="wave-ring"></div>
          <div className="wave-ring"></div>
          <div className="wave-ring"></div>
        </div>

        {/* Left Column: Content */}
        <div className="hero-content">
          <h1 className="hero-headline"><span className="highlight">Signl</span></h1>

          <p className="hero-subheadline">
            One platform to discover the right contacts, craft personalized outreach, and track every conversation. Land your dream role through genuine connections.
          </p>

          <div className="hero-features">
            <div className="feature-pill">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
              Find contacts
            </div>
            <div className="feature-pill">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
              Personalize outreach
            </div>
            <div className="feature-pill">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              Track conversations
            </div>
          </div>

          <button className="btn-primary-landing" onClick={handleGetStarted}>
            Get started free
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/>
              <path d="m12 5 7 7-7 7"/>
            </svg>
          </button>
        </div>

        {/* Right Column: App UI Animation */}
        <div className="hero-visual">
          <div className="app-container">
            <div className="app-frame">
              {/* Sidebar */}
              <div className="app-sidebar">
                <div className="sidebar-header">
                  <div className="sidebar-logo">
                    <div className="signal-icon">
                      <div className="dot"></div>
                      <div className="arc arc-1"></div>
                      <div className="arc arc-2"></div>
                    </div>
                    <span className="sidebar-title">Signl</span>
                  </div>
                </div>

                <div className="chat-area">
                  <div className="chat-bubble ai-greeting">
                    Hi! I&apos;m Signl. Who would you like to find today?
                    <div className="suggested-prompts">
                      <div className="prompt-link">Harvard alumni at Google</div>
                      <div className="prompt-link">VCs in San Francisco</div>
                      <div className="prompt-link">Product managers at Stripe</div>
                    </div>
                  </div>
                  <div className="chat-bubble user" ref={userMessageRef}></div>
                  <div className="chat-bubble ai-searching" ref={aiResponseRef}></div>
                </div>

                <div className="sidebar-input">
                  <span>Describe who you&apos;re looking for...</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m22 2-7 20-4-9-9-4Z"/>
                    <path d="M22 2 11 13"/>
                  </svg>
                </div>
              </div>

              {/* Main Content */}
              <div className="app-main">
                <div className="results-grid">
                  {people.map((person, index) => (
                    <div
                      key={person.initials}
                      className="person-card"
                      ref={el => { cardRefs.current[index] = el; }}
                    >
                      <div className="card-actions">
                        <svg className="card-action" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
                        </svg>
                        <svg className="card-action" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                        </svg>
                      </div>
                      <div className={`person-avatar ${person.color}`}>{person.initials}</div>
                      <div className="person-name">
                        {person.name}
                        <span className="linkedin-badge">in</span>
                      </div>
                      <div className="person-role">Product Manager</div>
                      <div className="person-details">
                        <div className="detail-row">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                          Stripe
                        </div>
                        <div className="detail-row">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                          UT Austin
                        </div>
                        <div className="detail-row">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>
                          New York, NY
                        </div>
                      </div>
                      <button className="send-email-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                        Send Email
                      </button>
                    </div>
                  ))}
                </div>

                <button className="load-more-btn" ref={loadMoreBtnRef}>Load More Profiles</button>

                {/* Loading State */}
                <div className="loading-state" ref={loadingStateRef}>
                  <div className="signal-animation">
                    <div className="dot"></div>
                    <div className="arc arc-1"></div>
                    <div className="arc arc-2"></div>
                    <div className="arc arc-3"></div>
                  </div>
                  <div className="loading-text">Locating profiles...</div>
                </div>

                {/* Compose Modal Overlay */}
                <div className="compose-overlay" ref={composeOverlayRef}>
                  <div className="compose-modal">
                    <div className="compose-header">
                      <span className="compose-title">Compose Email</span>
                      <svg className="compose-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18"/>
                        <path d="m6 6 12 12"/>
                      </svg>
                    </div>
                    <div className="compose-body">
                      <div className="compose-field">
                        <span className="compose-label">To:</span>
                        <span className="compose-value">Jennifer L., PM at Stripe</span>
                      </div>
                      <div className="compose-field">
                        <span className="compose-label">Subject:</span>
                        <span className="compose-subject">Quick question about Stripe</span>
                      </div>
                      <div className="compose-email-body">
                        <div className="typing-line" ref={el => { lineRefs.current[0] = el; }}>Hi Jennifer,</div>
                        <div className="typing-line" ref={el => { lineRefs.current[1] = el; }}><br/></div>
                        <div className="typing-line" ref={el => { lineRefs.current[2] = el; }}>I noticed you&apos;re a fellow Longhorn now leading product at Stripe — that&apos;s an inspiring path!</div>
                        <div className="typing-line" ref={el => { lineRefs.current[3] = el; }}><br/></div>
                        <div className="typing-line" ref={el => { lineRefs.current[4] = el; }}>I&apos;m a CS student exploring fintech PM roles. Would you have 15 mins to share how you made the transition?</div>
                      </div>
                      <div className="compose-footer">
                        <div className="ai-badge">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
                            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
                          </svg>
                          AI-personalized
                        </div>
                        <button className="send-btn" ref={sendBtnRef}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m22 2-7 20-4-9-9-4Z"/>
                            <path d="M22 2 11 13"/>
                          </svg>
                          <span ref={sendTextRef}>Send</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
    </section>
  );
}
