'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import {
  MagnifyingGlassIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  BuildingOfficeIcon,
  AcademicCapIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_PEOPLE = [
  {
    name: 'Sarah Chen',
    initials: 'SC',
    role: 'IB Analyst',
    company: 'Goldman Sachs',
    university: 'UT Austin',
    location: 'New York, NY',
    gradient: 'from-primary-400 to-primary-600',
  },
  {
    name: 'Michael Torres',
    initials: 'MT',
    role: 'Strategy Consultant',
    company: 'McKinsey',
    university: 'Rice University',
    location: 'Houston, TX',
    gradient: 'from-teal-400 to-teal-600',
  },
  {
    name: 'Priya Patel',
    initials: 'PP',
    role: 'Product Manager',
    company: 'Google',
    university: 'Stanford',
    location: 'San Francisco, CA',
    gradient: 'from-violet-400 to-violet-600',
  },
];

const STEPS = [
  {
    icon: MagnifyingGlassIcon,
    title: 'Search',
    description:
      'Filter by company, role, university, or location to find the right contacts.',
  },
  {
    icon: EnvelopeIcon,
    title: 'Personalize',
    description:
      'Review auto-generated emails personalized to each recipient\u2019s background.',
  },
  {
    icon: PaperAirplaneIcon,
    title: 'Send',
    description:
      'Send directly from your Gmail with one click and track results.',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NavBar({ callbackUrl }: { callbackUrl: string }) {
  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-subtle border-b border-surface-200/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="text-xl font-bold text-surface-900">Signl</span>
          </div>
          <button
            onClick={() => signIn('google', { callbackUrl })}
            className="text-sm font-medium text-surface-600 hover:text-surface-900 transition-colors"
          >
            Sign In
          </button>
        </div>
      </div>
    </header>
  );
}

function AuthError({ error }: { error: string }) {
  const message =
    error === 'OAuthCallback'
      ? 'There was a problem with Google sign-in. Please try again.'
      : error === 'OAuthAccountNotLinked'
      ? 'This email is already linked to another account.'
      : error === 'AccessDenied'
      ? 'Access was denied. Please grant the required permissions.'
      : `Authentication error: ${error}`;

  return (
    <div className="max-w-md mx-auto mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm animate-fade-in">
      <p className="font-semibold flex items-center justify-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Authentication failed
      </p>
      <p className="mt-1 text-red-600 text-center">{message}</p>
    </div>
  );
}

function Hero({ callbackUrl, error }: { callbackUrl: string; error: string | null }) {
  return (
    <section className="relative pt-20 pb-16 sm:pt-28 sm:pb-20 text-center px-4">
      {error && <AuthError error={error} />}
      <h1
        className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-surface-900 animate-fade-in-up"
      >
        Find the right people.{' '}
        <span className="text-gradient">Send the right email.</span>
      </h1>
      <p
        className="mt-6 max-w-2xl mx-auto text-lg sm:text-xl text-surface-500 animate-fade-in-up"
        style={{ animationDelay: '75ms' }}
      >
        Signl helps you discover professionals at top firms and send
        personalized outreach&nbsp;&mdash;&nbsp;in seconds.
      </p>
      <div className="mt-10 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
        <button
          onClick={() => signIn('google', { callbackUrl })}
          className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-primary-600 to-primary-500 text-white font-semibold text-lg rounded-xl shadow-md hover:shadow-glow hover:from-primary-700 hover:to-primary-600 transition-all duration-200"
        >
          {/* Google "G" icon */}
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Get Started with Google
        </button>
        <p className="mt-4 text-sm text-surface-400">
          Free to use &middot; No credit card required
        </p>
      </div>
    </section>
  );
}

function MockSearchForm() {
  return (
    <div className="card p-6 mb-6">
      <h2 className="text-xl font-bold text-surface-900 mb-4">Find People</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5 mb-6">
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Company
          </label>
          <div className="input text-sm text-surface-800">Goldman Sachs</div>
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Role
          </label>
          <div className="input text-sm text-surface-800">Analyst</div>
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            University
          </label>
          <div className="input text-sm text-surface-800">UT Austin</div>
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">
            Location
          </label>
          <div className="input text-sm text-surface-400">Any Location</div>
        </div>
      </div>
      <button className="btn-primary" tabIndex={-1}>Search</button>
    </div>
  );
}

function MockPersonCard({ person }: { person: typeof MOCK_PEOPLE[number] }) {
  return (
    <div className="card-hover p-5 flex flex-col items-center text-center">
      {/* Avatar */}
      <div className="mb-4">
        <div
          className={`w-16 h-16 rounded-full bg-gradient-to-br ${person.gradient} flex items-center justify-center shadow-md`}
        >
          <span className="text-white font-semibold text-lg">
            {person.initials}
          </span>
        </div>
      </div>

      {/* Name + LinkedIn badge */}
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-semibold text-surface-900 text-base">
          {person.name}
        </h3>
        <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-semibold text-white bg-[#0A66C2] rounded">
          in
        </span>
      </div>

      {/* Role */}
      <p className="text-sm text-primary-600 font-medium mb-4 truncate w-full">
        {person.role}
      </p>

      {/* Details */}
      <div className="w-full space-y-2 text-left mb-4">
        <div className="flex items-center gap-2">
          <BuildingOfficeIcon className="w-4 h-4 text-surface-400 flex-shrink-0" />
          <p className="text-sm text-surface-700 truncate">{person.company}</p>
        </div>
        <div className="flex items-center gap-2">
          <AcademicCapIcon className="w-4 h-4 text-surface-400 flex-shrink-0" />
          <p className="text-sm text-surface-500 truncate">
            {person.university}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MapPinIcon className="w-4 h-4 text-surface-400 flex-shrink-0" />
          <p className="text-sm text-surface-500 truncate">{person.location}</p>
        </div>
      </div>

      {/* CTA */}
      <div className="w-full mt-auto">
        <button className="text-sm w-full justify-center btn-primary" tabIndex={-1}>
          <EnvelopeIcon className="w-4 h-4 mr-1.5" />
          Send Email
        </button>
      </div>
    </div>
  );
}

function MockEmailModal() {
  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-surface-900/30 rounded-2xl" />

      {/* Modal */}
      <div className="absolute top-[12%] right-[4%] sm:right-[8%] w-[88%] sm:w-[60%] max-w-lg bg-white rounded-lg shadow-soft-xl flex flex-col z-10">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Sarah Chen</h2>
            <p className="text-sm text-surface-600">
              IB Analyst at Goldman Sachs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-surface-500">1 of 3</span>
            <div className="p-2 hover:bg-surface-100 rounded-full">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-surface-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Subject
            </label>
            <div className="input text-sm">
              UT Austin Senior interested in IB at Goldman Sachs
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Body
            </label>
            <div className="input text-sm whitespace-pre-line min-h-[180px] leading-relaxed">
              {`Hello Sarah,

I hope you are doing well! My name is Alex and I am a Senior studying Finance at UT Austin. I'm very interested in Investment Banking and would love to connect to hear about your experience at Goldman Sachs.

Would you be open to a brief 15-minute call sometime this week?

Warm regards,
Alex`}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-surface-50 rounded-b-lg">
          <div className="flex items-center justify-between p-4">
            <div className="flex gap-2">
              <span className="btn-secondary text-sm opacity-50">
                Previous
              </span>
              <span className="btn-secondary text-sm">Next</span>
            </div>
            <span className="btn-primary text-sm">Send &amp; Next</span>
          </div>
          <p className="text-xs text-surface-400 text-center pb-3">
            Esc to close &middot; Cmd/Ctrl+Enter to send
          </p>
        </div>
      </div>
    </>
  );
}

function AppPreview() {
  return (
    <section
      className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 animate-fade-in-up"
      style={{ animationDelay: '200ms' }}
    >
      {/* Desktop / tablet: full mockup */}
      <div
        className="hidden md:block relative rounded-2xl border border-surface-200/60 shadow-soft-xl bg-surface-50 overflow-hidden"
        style={{
          perspective: '1200px',
        }}
      >
        <div
          className="pointer-events-none select-none p-6 lg:p-8"
          style={{
            transform: 'perspective(1200px) rotateX(2deg)',
            transformOrigin: 'center top',
          }}
        >
          {/* Header bar inside mockup */}
          <div className="flex items-center gap-2 mb-6">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">S</span>
            </div>
            <span className="text-sm font-bold text-surface-900">Signl</span>
          </div>

          {/* Search form */}
          <MockSearchForm />

          {/* Results header */}
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-lg font-semibold text-surface-900">
              3 Results Found
            </h3>
          </div>

          {/* Results grid + email overlay */}
          <div className="relative">
            <div className="grid grid-cols-3 gap-4">
              {MOCK_PEOPLE.map((person) => (
                <MockPersonCard key={person.name} person={person} />
              ))}
            </div>

            {/* Email compose overlay */}
            <MockEmailModal />
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-white to-transparent pointer-events-none" />
      </div>

      {/* Mobile: simplified mockup (2 stacked cards, no modal) */}
      <div className="md:hidden relative rounded-2xl border border-surface-200/60 shadow-soft-xl bg-surface-50 overflow-hidden">
        <div className="pointer-events-none select-none p-4">
          {/* Mini header */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">S</span>
            </div>
            <span className="text-sm font-bold text-surface-900">Signl</span>
          </div>

          {/* Compact search */}
          <MockSearchForm />

          {/* Results */}
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-base font-semibold text-surface-900">
              3 Results Found
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {MOCK_PEOPLE.slice(0, 2).map((person) => (
              <MockPersonCard key={person.name} person={person} />
            ))}
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
      <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 text-center mb-12">
        How It Works
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="card p-6 text-center animate-fade-in-up"
            style={{ animationDelay: `${300 + i * 75}ms` }}
          >
            <div className="flex items-center justify-center mb-4">
              <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm">
                {i + 1}
              </div>
            </div>
            <step.icon className="w-8 h-8 mx-auto text-primary-500 mb-3" />
            <h3 className="text-lg font-semibold text-surface-900 mb-2">
              {step.title}
            </h3>
            <p className="text-sm text-surface-500 leading-relaxed">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-surface-200/60 py-8 text-center">
      <div className="flex items-center justify-center gap-4 text-sm text-surface-400">
        <a href="/privacy" className="hover:text-surface-600 transition-colors">
          Privacy Policy
        </a>
        <span>&middot;</span>
        <a href="/terms" className="hover:text-surface-600 transition-colors">
          Terms of Service
        </a>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function LandingPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-50 via-white to-primary-50/30">
      <NavBar callbackUrl={callbackUrl} />
      <Hero callbackUrl={callbackUrl} error={error} />
      <AppPreview />
      <HowItWorks />
      <Footer />
    </div>
  );
}
