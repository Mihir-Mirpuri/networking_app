'use client';

function SignalLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="80" r="12" fill="white" />
      <path className="animate-signal-arc-1" d="M78 56 A30 30 0 0 0 78 104" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path className="animate-signal-arc-1" d="M122 56 A30 30 0 0 1 122 104" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path className="animate-signal-arc-2" d="M58 38 A55 55 0 0 0 58 122" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path className="animate-signal-arc-2" d="M142 38 A55 55 0 0 1 142 122" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path className="animate-signal-arc-3" d="M38 20 A80 80 0 0 0 38 140" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path className="animate-signal-arc-3" d="M162 20 A80 80 0 0 1 162 140" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#212121] flex flex-col items-center justify-center">
      <div>
        <SignalLogo className="w-48 h-48" />
      </div>
      <p className="text-xl font-medium text-white mt-8 flex items-center gap-1">
        Loading
        <span className="flex gap-1 ml-1">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
      </p>
    </div>
  );
}
