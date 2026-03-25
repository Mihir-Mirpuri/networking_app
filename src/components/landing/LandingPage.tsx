'use client';

import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

const LOGOS = [
  'Google', 'Goldman Sachs', 'JPMorgan', 'Meta', 'Amazon', 'McKinsey', 'Deloitte',
];

export function LandingPage() {
  const router = useRouter();

  const handleGetStarted = () => {
    router.push('/app');
  };

  const handleLogIn = () => {
    signIn('google', { callbackUrl: '/app' });
  };

  return (
    <div className="h-screen bg-[#111111] text-white flex flex-col">
      {/* Navbar */}
      <nav className="flex items-center px-8 sm:px-20 py-5 gap-10">
        <span className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: 'var(--font-outfit), sans-serif' }}>
          signl
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          <button
            onClick={handleLogIn}
            className="text-sm font-medium text-[#909090] hover:text-white transition-colors hidden sm:block"
          >
            Log In
          </button>
          <button
            onClick={handleGetStarted}
            className="bg-[#6364FF] text-white text-sm font-semibold px-6 py-2.5 rounded-[10px] hover:bg-[#5354EE] transition-colors"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="flex flex-col lg:flex-row items-center px-8 sm:px-20 pt-10 pb-6 gap-10 flex-1">
        {/* Left: Text */}
        <div className="flex flex-col gap-4 flex-1">
          {/* Badge */}
          <div className="flex items-center gap-2 bg-[#1a1a1a] border border-[#303030] rounded-full px-5 py-2 w-fit">
            <span className="text-sm">🚀</span>
            <span className="text-[13px] font-medium text-[#909090]">Now in beta — Join 500+ students</span>
            <span className="text-sm text-[#6364FF]">→</span>
          </div>

          {/* Headline */}
          <h1
            className="text-7xl sm:text-[96px] font-black leading-[0.9] tracking-[-4px] text-white"
            style={{ fontFamily: 'var(--font-outfit), sans-serif' }}
          >
            Meet Signl
          </h1>

          {/* Subtitle */}
          <p className="text-[32px] sm:text-[50px] text-[#919191] font-normal leading-[1.1]">
            You&apos;re All in One<br />Recruiting Tool
          </p>

          {/* CTA */}
          <button
            onClick={handleGetStarted}
            className="bg-[#6364FF] text-white text-lg font-bold px-10 py-[18px] rounded-[14px] w-fit hover:bg-[#5354EE] transition-colors shadow-[0_8px_30px_rgba(99,100,255,0.2)]"
            style={{ fontFamily: 'var(--font-outfit), sans-serif' }}
          >
            Get Started — It&apos;s Free
          </button>
        </div>

        {/* Right: Product Preview */}
        <div className="w-full lg:w-[550px] h-[420px] bg-[#1a1a1a] border border-[#303030] rounded-xl flex flex-col items-center justify-center gap-4 shadow-[0_20px_60px_rgba(0,0,0,0.3)] shrink-0">
          <div className="w-[72px] h-[72px] bg-[#6364FF] rounded-full flex items-center justify-center">
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <span className="text-sm font-medium text-[#808080]">Product Demo</span>
        </div>
      </section>

      {/* Trusted By */}
      <section className="flex flex-col items-center py-6 gap-4 overflow-hidden">
        <p className="text-[15px] font-semibold text-[#606060] tracking-wide text-center">
          Trusted by students who landed offers at...
        </p>
        <div className="relative w-full">
          {/* Fade edges */}
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#111111] to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#111111] to-transparent z-10" />
          {/* Scrolling logos */}
          <div className="flex animate-marquee gap-16 items-center">
            {[...LOGOS, ...LOGOS].map((name, i) => (
              <span
                key={`${name}-${i}`}
                className="text-2xl sm:text-3xl font-bold text-[#555555] shrink-0 whitespace-nowrap"
                style={{ fontFamily: 'Georgia, serif' }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
