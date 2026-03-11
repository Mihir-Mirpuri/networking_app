'use client';

import { useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

// Company/university logos for trusted-by section
const TRUSTED_BY = [
  { name: 'Duke University', domain: 'duke.edu' },
  { name: 'University of Oxford', domain: 'ox.ac.uk' },
  { name: 'UT Austin', domain: 'utexas.edu' },
  { name: 'Google', domain: 'google.com' },
  { name: 'Princeton University', domain: 'princeton.edu' },
  { name: 'Goldman Sachs', domain: 'goldmansachs.com' },
  { name: 'McKinsey', domain: 'mckinsey.com' },
  { name: 'Amazon', domain: 'amazon.com' },
  { name: 'Apple', domain: 'apple.com' },
  { name: 'JPMorgan', domain: 'jpmorgan.com' },
];

// Mascot SVG component
function MascotSVG({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="54" fill="url(#mascotBg)" opacity="0.9"/>
      <path
        d="M18 60 Q25 42 32 60 Q39 78 46 60 Q53 42 60 60 Q67 78 74 60 Q81 42 88 60 Q95 78 102 60"
        stroke="url(#waveGrad)"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
        className="wave-path"
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
        <linearGradient id="waveGrad" x1="18" y1="60" x2="102" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0053CC"/>
          <stop offset="50%" stopColor="#6364FF"/>
          <stop offset="100%" stopColor="#0053CC"/>
        </linearGradient>
        <radialGradient id="mascotBg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1E3B8A" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#0A0E1A" stopOpacity="0.95"/>
        </radialGradient>
      </defs>
    </svg>
  );
}

// Checkmark icon for pricing features
function CheckIcon() {
  return (
    <svg viewBox="0 0 10 10" fill="none" className="w-2 h-2">
      <path d="M2 5l2.5 2.5L8 3" stroke="#6364FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Trusted-by logo component
function TrustedLogo({ name, domain }: { name: string; domain: string }) {
  return (
    <div className="trusted-logo-item">
      <img
        className="trusted-logo-img"
        src={`https://logo.clearbit.com/${domain}`}
        alt={name}
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          if (!target.src.includes('google.com')) {
            target.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
          }
        }}
      />
    </div>
  );
}

// Pricing card component
function PricingCard({
  name,
  price,
  period,
  features,
  featured = false,
  buttonText,
  onButtonClick,
  delay = '0s'
}: {
  name: string;
  price: string;
  period: string;
  features: string[];
  featured?: boolean;
  buttonText: string;
  onButtonClick: () => void;
  delay?: string;
}) {
  return (
    <div
      className={`pricing-card reveal ${featured ? 'featured' : ''}`}
      style={{ transitionDelay: delay }}
    >
      {featured && <div className="popular-badge">Most Popular</div>}
      <div className="plan-name">{name}</div>
      <div className="plan-price" dangerouslySetInnerHTML={{ __html: price }} />
      <div className="plan-period">{period}</div>
      <div className="plan-divider" />
      <ul className="plan-features">
        {features.map((feature, i) => (
          <li key={i} className="plan-feature">
            <div className="plan-feature-icon">
              <CheckIcon />
            </div>
            {feature}
          </li>
        ))}
      </ul>
      <button
        className={`plan-btn ${featured ? 'plan-btn-primary' : 'plan-btn-outline'}`}
        onClick={onButtonClick}
      >
        {buttonText}
      </button>
    </div>
  );
}

export function LandingPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const ref = searchParams.get('ref');

  // Set up intersection observer for reveal animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('visible');
        });
      },
      { threshold: 0.1 }
    );
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Track referral clicks
  useEffect(() => {
    if (!ref) return;
    document.cookie = `signl_ref=${encodeURIComponent(ref)}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
    fetch('/api/referral/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ref }),
    }).catch(() => {});
  }, [ref]);

  const handleSignIn = () => signIn('google', { callbackUrl });

  return (
    <>
      <style jsx global>{`
        :root {
          --black: #000000;
          --blue-deep: #1E3B8A;
          --blue-mid: #324095;
          --blue-bright: #0053CC;
          --blue-electric: #6364FF;
          --white: #FFFFFF;
          --gray: #8A8FA8;
          --surface: #000000;
          --surface2: #0a0a0a;
        }

        .landing-page * { margin: 0; padding: 0; box-sizing: border-box; }

        .landing-page {
          background: var(--black);
          color: var(--white);
          font-family: 'Inter', sans-serif;
          overflow-x: hidden;
          min-height: 100vh;
        }

        .landing-page::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
          pointer-events: none;
          z-index: 1000;
          opacity: 0.4;
        }

        /* NAV */
        .landing-nav {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 48px;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(99,100,255,0.1);
        }

        .nav-logo-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .nav-logo {
          font-size: 22px;
          font-weight: 900;
          letter-spacing: 1px;
          color: var(--white);
          text-transform: uppercase;
        }

        .nav-logo .p { color: var(--blue-electric); }

        /* UT BADGE */
        .ut-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(191,87,0,0.1);
          border: 1px solid rgba(191,87,0,0.25);
          color: #FF9D45;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          padding: 6px 12px;
          border-radius: 100px;
          white-space: nowrap;
        }

        /* HERO */
        .hero {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          padding-top: 72px;
        }

        .hero-main {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 80px;
          padding: 60px 80px;
          position: relative;
          z-index: 2;
        }

        .hero::after {
          content: '';
          position: absolute;
          width: 700px; height: 700px;
          background: radial-gradient(circle, rgba(99,100,255,0.09) 0%, transparent 70%);
          top: 40%; left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
        }

        .hero-grid-bg {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(99,100,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,100,255,0.04) 1px, transparent 1px);
          background-size: 60px 60px;
          mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
        }

        /* MASCOT */
        .hero-mascot-side {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .mascot-wrapper {
          position: relative;
          z-index: 2;
        }

        .mascot-svg {
          width: 280px; height: 280px;
          filter: drop-shadow(0 0 40px rgba(99,100,255,0.5));
          animation: mascot-float 3s ease-in-out infinite;
        }

        @keyframes mascot-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-16px); }
        }

        .mascot-ring {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 300px; height: 300px;
          border-radius: 50%;
          border: 1px solid rgba(99,100,255,0.2);
          animation: ring-pulse 2.5s ease-out infinite;
        }

        .mascot-ring:nth-child(2) { animation-delay: 0.8s; }
        .mascot-ring:nth-child(3) { animation-delay: 1.6s; }

        @keyframes ring-pulse {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.4; }
          100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }

        /* TEXT */
        .hero-text-side {
          flex: 0 0 auto;
          max-width: 500px;
          z-index: 2;
        }

        .hero-headline {
          font-size: clamp(44px, 5vw, 72px);
          font-weight: 900;
          line-height: 1.0;
          letter-spacing: -3px;
          animation: fade-up 0.6s ease forwards;
          opacity: 0;
          animation-delay: 0.1s;
          margin-bottom: 0;
        }

        .hero-headline .gradient-text {
          background: linear-gradient(135deg, #6364FF 0%, #0053CC 50%, #6364FF 100%);
          background-size: 200% 200%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: gradient-shift 4s ease infinite;
        }

        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        .hero-actions {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 36px;
          animation: fade-up 0.6s ease forwards;
          opacity: 0;
          animation-delay: 0.25s;
          max-width: 360px;
        }

        .btn-primary {
          background: var(--blue-electric);
          color: white;
          border: none;
          padding: 16px 34px;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          font-family: 'Inter', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          width: 100%;
        }

        .btn-primary:hover {
          background: #7879ff;
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(99,100,255,0.35);
        }

        .btn-secondary {
          background: transparent;
          color: var(--blue-electric);
          border: 2px solid var(--blue-electric);
          padding: 14px 34px;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          font-family: 'Inter', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          width: 100%;
        }

        .btn-secondary:hover {
          background: rgba(99,100,255,0.08);
        }

        @keyframes fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* TRUSTED BY */
        .hero-ticker {
          border-top: 1px solid rgba(255,255,255,0.07);
          background: rgba(10,14,26,0.85);
          backdrop-filter: blur(8px);
          padding: 32px 0 36px;
          overflow: hidden;
          position: relative;
          z-index: 2;
        }

        .hero-ticker-label {
          text-align: center;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.5px;
          color: rgba(99,100,255,0.7);
          margin-bottom: 28px;
        }

        .trusted-logos-row {
          position: relative;
          overflow: hidden;
        }

        .trusted-track {
          display: flex;
          align-items: center;
          width: max-content;
          animation: ticker-scroll 35s linear infinite;
        }

        .trusted-track:hover { animation-play-state: paused; }

        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        .trusted-logo-item {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 40px;
        }

        .trusted-logo-img {
          height: 40px;
          width: auto;
          max-width: 140px;
          object-fit: contain;
          filter: grayscale(100%) brightness(0.6);
          opacity: 0.5;
          transition: all 0.3s ease;
        }

        .trusted-logo-item:hover .trusted-logo-img {
          filter: grayscale(0%) brightness(1);
          opacity: 0.9;
        }

        .trusted-fade-left, .trusted-fade-right {
          position: absolute;
          top: 0; bottom: 0;
          width: 120px;
          z-index: 2;
          pointer-events: none;
        }

        .trusted-fade-left { left: 0; background: linear-gradient(to right, rgba(10,14,26,0.85), transparent); }
        .trusted-fade-right { right: 0; background: linear-gradient(to left, rgba(10,14,26,0.85), transparent); }

        /* HOW IT WORKS */
        .how-split {
          background: var(--surface);
          padding: 0 80px;
          border-top: 1px solid rgba(99,100,255,0.08);
          min-height: 100vh;
          display: flex;
          align-items: center;
        }

        .how-split-inner {
          max-width: 1100px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 420px 1fr;
          gap: 80px;
          align-items: center;
          width: 100%;
        }

        .section-label {
          font-size: 52px;
          letter-spacing: -2px;
          font-weight: 900;
          color: white;
          line-height: 1;
          white-space: nowrap;
        }

        .how-split-title {
          font-size: clamp(16px, 1.8vw, 22px);
          font-weight: 600;
          letter-spacing: -0.3px;
          line-height: 1.8;
          margin-top: 14px;
          color: var(--gray);
        }

        .video-chrome {
          background: #0d1220;
          border: 1px solid rgba(99,100,255,0.15);
          border-bottom: none;
          border-radius: 12px 12px 0 0;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .chrome-dot { width: 12px; height: 12px; border-radius: 50%; }

        .chrome-bar {
          flex: 1;
          height: 26px;
          background: rgba(255,255,255,0.04);
          border-radius: 6px;
          margin: 0 8px;
          display: flex; align-items: center;
          padding: 0 12px;
        }

        .chrome-url { font-size: 12px; color: var(--gray); font-family: monospace; }

        .video-placeholder {
          width: 100%;
          aspect-ratio: 16/9;
          background: var(--surface2);
          border: 1px solid rgba(99,100,255,0.15);
          border-radius: 0 0 12px 12px;
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .video-placeholder::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(99,100,255,0.05) 0%, transparent 60%);
        }

        .video-placeholder::after {
          content: '';
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg, transparent, transparent 2px,
            rgba(99,100,255,0.015) 2px, rgba(99,100,255,0.015) 4px
          );
        }

        .video-play-btn {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .play-circle {
          width: 72px; height: 72px;
          background: rgba(99,100,255,0.15);
          border: 2px solid rgba(99,100,255,0.4);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
          backdrop-filter: blur(8px);
        }

        .video-placeholder:hover .play-circle {
          background: rgba(99,100,255,0.25);
          border-color: var(--blue-electric);
          transform: scale(1.08);
        }

        .play-triangle {
          width: 0; height: 0;
          border-top: 11px solid transparent;
          border-bottom: 11px solid transparent;
          border-left: 18px solid var(--blue-electric);
          margin-left: 4px;
        }

        .video-label { font-size: 14px; font-weight: 600; color: var(--gray); letter-spacing: 0.5px; }

        /* PROOF SECTION */
        .proof-section {
          background: var(--black);
          padding: 100px 80px;
          border-top: 1px solid rgba(255,255,255,0.05);
        }

        .proof-inner {
          max-width: 1100px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 80px;
          align-items: center;
        }

        .proof-right {
          display: flex;
          flex-direction: column;
          gap: 0;
          padding-left: 48px;
        }

        .vstat {
          padding: 28px 0;
        }

        .vstat-num {
          font-size: 48px;
          font-weight: 900;
          color: var(--blue-electric);
          letter-spacing: -2px;
          line-height: 1;
        }

        .vstat-label {
          font-size: 14px;
          font-weight: 700;
          color: var(--white);
          margin-top: 6px;
          letter-spacing: -0.3px;
        }

        .vstat-context {
          font-size: 12px;
          color: var(--gray);
          margin-top: 3px;
          font-style: italic;
        }

        .vstat-line {
          height: 1px;
          background: rgba(255,255,255,0.07);
          width: 100%;
        }

        /* EMAIL MOCKUP */
        .email-mockup {
          background: var(--surface2);
          border: 1px solid rgba(99,100,255,0.15);
          border-radius: 16px;
          padding: 28px;
          position: relative;
        }

        .email-mockup::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(99,100,255,0.15), transparent 50%);
          pointer-events: none;
        }

        .email-header {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 20px;
          padding-bottom: 14px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }

        .email-avatar {
          width: 34px; height: 34px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6364FF, #0053CC);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700;
        }

        .email-meta { flex: 1; }
        .email-name { font-size: 13px; font-weight: 700; }
        .email-addr { font-size: 11px; color: var(--gray); }

        .email-badge {
          background: rgba(99,100,255,0.12);
          color: var(--blue-electric);
          font-size: 10px; font-weight: 700;
          padding: 4px 9px; border-radius: 20px;
        }

        .email-body p { font-size: 13px; color: #ccc; line-height: 1.7; margin-bottom: 10px; }

        .email-highlight {
          background: rgba(99,100,255,0.08);
          border-left: 2px solid var(--blue-electric);
          padding: 9px 13px;
          border-radius: 0 6px 6px 0;
          margin: 14px 0;
          font-size: 12px; color: #aab; font-style: italic;
        }

        /* PRICING */
        .pricing {
          background: var(--surface);
          padding: 60px 48px;
        }

        .pricing-inner { max-width: 1000px; margin: 0 auto; }

        .pricing-header { text-align: center; margin-bottom: 32px; }

        .section-title {
          font-size: clamp(40px, 5vw, 72px);
          font-weight: 900;
          letter-spacing: -3px;
          line-height: 1.05;
        }

        .pricing-cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2px;
        }

        .pricing-card {
          background: var(--surface2);
          padding: 28px 24px;
          position: relative;
          transition: background 0.3s;
        }

        .pricing-card:first-child { border-radius: 16px 0 0 16px; }
        .pricing-card:last-child { border-radius: 0 16px 16px 0; }

        .pricing-card.featured {
          background: #0d1630;
          border: 1px solid rgba(99,100,255,0.35);
          border-radius: 16px;
          z-index: 2;
          transform: translateY(-6px);
          box-shadow: 0 0 40px rgba(99,100,255,0.12);
        }

        .pricing-card:hover { background: #121828; }
        .pricing-card.featured:hover { background: #0f1835; }

        .popular-badge {
          display: inline-block;
          background: var(--blue-electric);
          color: white;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 20px;
          margin-bottom: 12px;
        }

        .plan-name {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--gray);
          margin-bottom: 8px;
        }

        .plan-price {
          font-size: 36px;
          font-weight: 900;
          letter-spacing: -2px;
          line-height: 1;
          margin-bottom: 4px;
        }

        .plan-price span {
          font-size: 15px;
          font-weight: 600;
          color: var(--gray);
          letter-spacing: 0;
        }

        .plan-period {
          font-size: 12px;
          color: var(--gray);
          margin-bottom: 18px;
        }

        .plan-divider {
          height: 1px;
          background: rgba(255,255,255,0.06);
          margin-bottom: 16px;
        }

        .plan-features { list-style: none; display: flex; flex-direction: column; gap: 9px; margin-bottom: 20px; }

        .plan-feature {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 12px;
          color: #ccc;
          line-height: 1.4;
        }

        .plan-feature-icon {
          width: 15px; height: 15px;
          border-radius: 50%;
          background: rgba(99,100,255,0.15);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          margin-top: 1px;
        }

        .plan-btn {
          width: 100%;
          padding: 10px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          transition: all 0.2s;
          border: none;
        }

        .plan-btn-outline {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.15);
          color: var(--white);
        }

        .plan-btn-outline:hover {
          border-color: rgba(255,255,255,0.3);
          background: rgba(255,255,255,0.04);
        }

        .plan-btn-primary {
          background: var(--blue-electric);
          color: white;
        }

        .plan-btn-primary:hover {
          background: #7879ff;
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(99,100,255,0.3);
        }

        .guarantee {
          margin-top: 16px;
          border: 1px solid rgba(99,100,255,0.2);
          border-radius: 14px;
          padding: 18px 28px;
          background: rgba(99,100,255,0.05);
        }

        .guarantee-inner {
          display: flex;
          align-items: center;
          gap: 18px;
          max-width: 560px;
          margin: 0 auto;
        }

        .guarantee-icon { font-size: 28px; flex-shrink: 0; }

        .guarantee-title {
          font-size: 15px;
          font-weight: 800;
          color: var(--white);
          margin-bottom: 4px;
          letter-spacing: -0.3px;
        }

        .guarantee-desc {
          font-size: 13px;
          color: var(--gray);
          line-height: 1.5;
        }

        /* FOOTER */
        .landing-footer {
          padding: 36px 48px;
          border-top: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; justify-content: space-between;
        }

        .footer-logo { font-size: 15px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
        .footer-logo .p { color: var(--blue-electric); }
        .footer-copy { font-size: 13px; color: var(--gray); }

        /* REVEAL ANIMATIONS */
        .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s ease; }
        .reveal.visible { opacity: 1; transform: translateY(0); }

        /* RESPONSIVE */
        @media (max-width: 1024px) {
          .hero-main {
            flex-direction: column;
            gap: 40px;
            padding: 40px 24px;
          }
          .hero-text-side {
            text-align: center;
            max-width: 100%;
          }
          .hero-actions {
            margin: 36px auto 0;
          }
          .how-split {
            padding: 60px 24px;
            min-height: auto;
          }
          .how-split-inner {
            grid-template-columns: 1fr;
            gap: 40px;
          }
          .how-split-text {
            text-align: center;
          }
          .section-label {
            font-size: 36px;
          }
          .proof-section {
            padding: 60px 24px;
          }
          .proof-inner {
            grid-template-columns: 1fr;
            gap: 40px;
          }
          .proof-right {
            padding-left: 0;
          }
          .pricing {
            padding: 60px 24px;
          }
          .pricing-cards {
            grid-template-columns: 1fr;
            gap: 16px;
          }
          .pricing-card:first-child,
          .pricing-card:last-child {
            border-radius: 16px;
          }
          .pricing-card.featured {
            transform: none;
          }
          .landing-nav {
            padding: 16px 24px;
          }
          .ut-badge {
            display: none;
          }
          .landing-footer {
            flex-direction: column;
            gap: 12px;
            text-align: center;
          }
        }

        @media (max-width: 640px) {
          .mascot-svg {
            width: 200px;
            height: 200px;
          }
          .mascot-ring {
            width: 220px;
            height: 220px;
          }
          .hero-headline {
            font-size: 36px;
            letter-spacing: -2px;
          }
        }
      `}</style>

      <div className="landing-page">
        {/* NAV */}
        <nav className="landing-nav">
          <div className="nav-logo-group">
            <div className="nav-logo">SIG<span className="p">N</span><span className="p">L</span></div>
            <div className="ut-badge">Exclusive to UT Austin Students</div>
          </div>
        </nav>

        {/* HERO */}
        <div className="hero">
          <div className="hero-grid-bg" />

          <div className="hero-main">
            {/* LEFT: Mascot */}
            <div className="hero-mascot-side">
              <div className="mascot-wrapper">
                <div className="mascot-ring" />
                <div className="mascot-ring" />
                <div className="mascot-ring" />
                <MascotSVG className="mascot-svg" />
              </div>
            </div>

            {/* RIGHT: Text */}
            <div className="hero-text-side">
              <h1 className="hero-headline">
                Outreach<br/>
                <span className="gradient-text">Made Simple.</span>
              </h1>
              <div className="hero-actions">
                <button className="btn-primary" onClick={handleSignIn}>GET STARTED</button>
                <button className="btn-secondary" onClick={handleSignIn}>I ALREADY HAVE AN ACCOUNT</button>
              </div>
            </div>
          </div>

          {/* BOTTOM: Trusted by logos */}
          <div className="hero-ticker">
            <p className="hero-ticker-label">Trusted by students and professionals at...</p>
            <div className="trusted-logos-row">
              <div className="trusted-fade-left" />
              <div className="trusted-fade-right" />
              <div className="trusted-track">
                {[...TRUSTED_BY, ...TRUSTED_BY].map((company, i) => (
                  <TrustedLogo key={`${company.name}-${i}`} name={company.name} domain={company.domain} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* HOW IT WORKS */}
        <div className="how-split" id="how">
          <div className="how-split-inner">
            <div className="how-split-text reveal">
              <p className="section-label">How it works</p>
              <h2 className="how-split-title">
                Find the right connections.<br/>
                Personalize the email.<br/>
                Send at scale.
              </h2>
            </div>

            <div className="how-split-video reveal" style={{ transitionDelay: '0.2s' }}>
              <div className="video-chrome">
                <div className="chrome-dot" style={{ background: '#FF5F57' }} />
                <div className="chrome-dot" style={{ background: '#FFBD2E' }} />
                <div className="chrome-dot" style={{ background: '#28C840' }} />
                <div className="chrome-bar">
                  <span className="chrome-url">signl.app</span>
                </div>
              </div>
              <div className="video-placeholder">
                <div className="video-play-btn">
                  <div className="play-circle">
                    <div className="play-triangle" />
                  </div>
                  <span className="video-label">Watch Signl in action — 60 seconds</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SOCIAL PROOF */}
        <section className="proof-section">
          <div className="proof-inner">
            <div className="proof-left reveal">
              <div className="email-mockup">
                <div className="email-header">
                  <div className="email-avatar">JK</div>
                  <div className="email-meta">
                    <div className="email-name">Jordan Kim</div>
                    <div className="email-addr">jordan.kim@stripe.com</div>
                  </div>
                  <div className="email-badge">Default Template</div>
                </div>
                <div className="email-body">
                  <p>Hi Jordan,</p>
                  <div className="email-highlight">
                    🎯 Signl found: Both UT Austin CS. Jordan led fintech infra at JPMorgan before Stripe.
                  </div>
                  <p>
                    I came across your work on Stripe&apos;s infrastructure team — the path from JPMorgan&apos;s
                    fintech division to Stripe is something I find genuinely interesting, especially as a
                    CS senior at UT Austin trying to figure out where to take my backend experience.
                  </p>
                  <p>
                    Would love 20 minutes to hear how you made that transition. Happy to work around your schedule.
                  </p>
                  <p style={{ color: '#555', fontSize: '12px', marginTop: '18px' }}>
                    — Alex Rivera · alex@utexas.edu
                  </p>
                </div>
              </div>
            </div>

            <div className="proof-right reveal" style={{ transitionDelay: '0.2s' }}>
              <div className="vstat">
                <div className="vstat-num">~20s</div>
                <div className="vstat-label">Per personalized email</div>
                <div className="vstat-context">vs. 5–10 min manually</div>
              </div>
              <div className="vstat-line" />
              <div className="vstat">
                <div className="vstat-num">1</div>
                <div className="vstat-label">Tool instead of four</div>
                <div className="vstat-context">LinkedIn · Apollo · ChatGPT · Gmail</div>
              </div>
              <div className="vstat-line" />
              <div className="vstat">
                <div className="vstat-num">0</div>
                <div className="vstat-label">AI-generated slop</div>
                <div className="vstat-context">Emails that actually sound like you</div>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section className="pricing" id="pricing">
          <div className="pricing-inner">
            <div className="pricing-header reveal">
              <h2 className="section-title">Pricing</h2>
            </div>
            <div className="pricing-cards">
              <PricingCard
                name="Free"
                price="$0"
                period="forever"
                features={[
                  '10 emails per day',
                  'AI personalization',
                  'Find verified emails',
                  'Send emails from Signl',
                  '+10 bonus emails/day for each referral',
                ]}
                buttonText="Get Started Free"
                onButtonClick={handleSignIn}
              />
              <PricingCard
                name="Basic"
                price="$12<span>/mo</span>"
                period="billed monthly"
                features={[
                  '20 emails per day',
                  'AI personalization',
                  'Find verified emails',
                  'Send emails from Signl',
                  '+10 bonus emails/day for each referral',
                ]}
                buttonText="Get Started"
                onButtonClick={handleSignIn}
                delay="0.15s"
              />
              <PricingCard
                name="Unlimited"
                price="$20<span>/mo</span>"
                period="billed monthly"
                features={[
                  'Unlimited emails per day',
                  'AI personalization',
                  'Find verified emails',
                  'Send emails from Signl',
                  '+10 bonus emails/day for each referral',
                ]}
                featured
                buttonText="Get Unlimited"
                onButtonClick={handleSignIn}
                delay="0.3s"
              />
            </div>

            <div className="guarantee reveal">
              <div className="guarantee-inner">
                <span className="guarantee-icon">🛡️</span>
                <div>
                  <div className="guarantee-title">Money-back guarantee</div>
                  <div className="guarantee-desc">
                    If you don&apos;t get 15 coffee chats in your first 2 weeks, we&apos;ll refund you. No questions asked.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="landing-footer">
          <div className="footer-logo">SIG<span className="p">N</span><span className="p">L</span></div>
          <div className="footer-copy">© 2026 Signl. Built at UT Austin. 🤘</div>
        </footer>
      </div>
    </>
  );
}
