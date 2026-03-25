'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';

// Company logos for ticker
const TICKER_COMPANIES = [
  { name: 'Amazon', domain: 'amazon.com' },
  { name: 'Samsung', domain: 'samsung.com' },
  { name: 'McKinsey', domain: 'mckinsey.com' },
  { name: 'Cisco', domain: 'cisco.com' },
  { name: 'IBM', domain: 'ibm.com' },
  { name: 'ScotiaBank', domain: 'scotiabank.com' },
  { name: 'EY', domain: 'ey.com' },
  { name: 'ServiceNow', domain: 'servicenow.com' },
  { name: 'Google', domain: 'google.com' },
  { name: 'Dell', domain: 'dell.com' },
  { name: 'Apple', domain: 'apple.com' },
  { name: 'PepsiCo', domain: 'pepsico.com' },
  { name: 'Jefferies', domain: 'jefferies.com' },
];

// Mascot SVG component
function MascotSVG({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="54" fill="url(#mascotBgWelcome)" opacity="0.9"/>
      <path
        d="M18 60 Q25 42 32 60 Q39 78 46 60 Q53 42 60 60 Q67 78 74 60 Q81 42 88 60 Q95 78 102 60"
        stroke="url(#waveGradWelcome)"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="52" cy="52" r="5" fill="white"/>
      <circle cx="68" cy="52" r="5" fill="white"/>
      <circle cx="53.5" cy="53.5" r="2.5" fill="#0A0E1A"/>
      <circle cx="69.5" cy="53.5" r="2.5" fill="#0A0E1A"/>
      <circle cx="54.5" cy="52.5" r="1" fill="white" opacity="0.8"/>
      <circle cx="70.5" cy="52.5" r="1" fill="white" opacity="0.8"/>
      <path d="M52 70 Q60 77 68 70" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <line x1="60" y1="6" x2="60" y2="22" stroke="#6364FF" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="60" cy="5" r="3.5" fill="#6364FF"/>
      <circle cx="60" cy="5" r="6" fill="rgba(99,100,255,0.2)"/>
      <defs>
        <linearGradient id="waveGradWelcome" x1="18" y1="60" x2="102" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0053CC"/>
          <stop offset="50%" stopColor="#6364FF"/>
          <stop offset="100%" stopColor="#0053CC"/>
        </linearGradient>
        <radialGradient id="mascotBgWelcome" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1E3B8A" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#0A0E1A" stopOpacity="0.95"/>
        </radialGradient>
      </defs>
    </svg>
  );
}

// Ticker item component
function TickerItem({ name, domain }: { name: string; domain: string }) {
  return (
    <div className="flex items-center gap-3 px-8 whitespace-nowrap">
      <img
        className="w-8 h-8 rounded object-contain filter grayscale brightness-75 hover:grayscale-0 hover:brightness-100 transition-all"
        src={`https://logo.clearbit.com/${domain}`}
        alt={name}
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          if (!target.src.includes('google.com')) {
            target.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
          }
        }}
      />
      <span className="text-base font-medium text-white/50">{name}</span>
    </div>
  );
}

interface WelcomeModalProps {
  onClose: () => void;
}

export function WelcomeModal({ onClose }: WelcomeModalProps) {
  const handleGetStarted = () => {
    onClose();
  };

  const handleSignIn = () => {
    signIn('google', { callbackUrl: '/app' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleGetStarted}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-[#0a0a0a] border border-[#252525] rounded-2xl overflow-hidden shadow-2xl">
        {/* Background grid pattern */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              linear-gradient(rgba(99,100,255,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(99,100,255,0.03) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />

        {/* Close button */}
        <button
          onClick={handleGetStarted}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <div className="relative px-8 pt-10 pb-6">
          {/* Mascot */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <MascotSVG className="w-24 h-24 animate-bounce-slow" />
              {/* Glow effect */}
              <div className="absolute inset-0 blur-2xl bg-[#6364FF]/20 -z-10" />
            </div>
          </div>

          {/* UT Badge */}
          <div className="flex justify-center mb-4">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#BF5700]/10 border border-[#BF5700]/25 text-[#FF9D45] text-xs font-semibold uppercase tracking-wider">
              Exclusive to UT Austin Students
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-3xl font-bold text-white text-center mb-3">
            Outreach <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#6364FF] to-[#0053CC]">Made Simple</span>
          </h1>

          {/* Description */}
          <p className="text-[#808080] text-center mb-8">
            Send high-quality personalized emails at mass
          </p>

          {/* Features */}
          <div className="space-y-4 mb-8">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#6364FF]/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#6364FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold mb-0.5">Discover</h3>
                <p className="text-sm text-[#606060]">Search by company, role, location, or university</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#6364FF]/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#6364FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold mb-0.5">Personalize</h3>
                <p className="text-sm text-[#606060]">AI writes emails that actually sound like you</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#6364FF]/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#6364FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold mb-0.5">Send</h3>
                <p className="text-sm text-[#606060]">One-click send directly from your Gmail</p>
              </div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="space-y-3">
            <button
              onClick={handleGetStarted}
              className="w-full py-3 px-6 rounded-xl bg-[#6364FF] hover:bg-[#7879ff] text-white font-semibold transition-all hover:shadow-lg hover:shadow-[#6364FF]/25"
            >
              Get Started
            </button>
            <button
              onClick={handleSignIn}
              className="w-full py-2.5 px-6 rounded-xl bg-transparent border border-[#303030] hover:border-[#404040] text-[#808080] hover:text-white text-sm font-medium transition-colors"
            >
              Already have an account? Sign in
            </button>
          </div>
        </div>

        {/* Company ticker */}
        <div className="relative border-t border-[#1a1a1a] bg-black/40 py-6 overflow-hidden">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-[#505050] mb-4">
            UT Students landed offers at
          </p>
          <div className="relative">
            {/* Fade edges */}
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-[#0a0a0a] to-transparent z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-[#0a0a0a] to-transparent z-10" />

            {/* Scrolling ticker */}
            <div className="flex animate-ticker">
              {[...TICKER_COMPANIES, ...TICKER_COMPANIES].map((company, i) => (
                <TickerItem key={`${company.name}-${i}`} name={company.name} domain={company.domain} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Animation styles */}
      <style jsx global>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-ticker {
          animation: ticker-scroll 25s linear infinite;
        }
        .animate-ticker:hover {
          animation-play-state: paused;
        }
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

// Hook to check if welcome modal should be shown
// Always show for unauthenticated users (auth check happens in AppWrapper)
export function useWelcomeModal() {
  const [showModal, setShowModal] = useState(true);

  const closeModal = () => {
    setShowModal(false);
  };

  return { showModal, closeModal };
}
