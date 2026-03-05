'use client';

import { useState, useEffect } from 'react';

function BouncingMascot() {
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [direction, setDirection] = useState({ x: 1, y: 1 });
  const [bounce, setBounce] = useState(0);

  // Define the text area boundaries (center region where text lives)
  const textBox = { left: 25, right: 75, top: 35, bottom: 65 };
  const charSize = 12; // Character size in percentage units

  useEffect(() => {
    const moveInterval = setInterval(() => {
      setPosition((prev) => {
        let newX = prev.x + direction.x * 1.5;
        let newY = prev.y + direction.y * 1.0;
        let newDirX = direction.x;
        let newDirY = direction.y;

        // Bounce off edges
        if (newX <= 5 || newX >= 95) {
          newDirX = -direction.x;
          newX = Math.max(5, Math.min(95, newX));
        }
        if (newY <= 5 || newY >= 95) {
          newDirY = -direction.y;
          newY = Math.max(5, Math.min(95, newY));
        }

        // Bounce off the center text area
        const charLeft = newX - charSize / 2;
        const charRight = newX + charSize / 2;
        const charTop = newY - charSize / 2;
        const charBottom = newY + charSize / 2;

        const isOverlappingX = charRight > textBox.left && charLeft < textBox.right;
        const isOverlappingY = charBottom > textBox.top && charTop < textBox.bottom;

        if (isOverlappingX && isOverlappingY) {
          const prevX = prev.x;
          const prevY = prev.y;
          const prevLeft = prevX - charSize / 2;
          const prevRight = prevX + charSize / 2;
          const prevTop = prevY - charSize / 2;
          const prevBottom = prevY + charSize / 2;

          const wasOverlappingX = prevRight > textBox.left && prevLeft < textBox.right;
          const wasOverlappingY = prevBottom > textBox.top && prevTop < textBox.bottom;

          if (!wasOverlappingX && isOverlappingX) {
            newDirX = -direction.x;
            newX = direction.x > 0 ? textBox.left - charSize / 2 : textBox.right + charSize / 2;
          }
          if (!wasOverlappingY && isOverlappingY) {
            newDirY = -direction.y;
            newY = direction.y > 0 ? textBox.top - charSize / 2 : textBox.bottom + charSize / 2;
          }
        }

        // Occasional random direction change
        if (Math.random() < 0.015) {
          newDirX = Math.random() > 0.5 ? 1 : -1;
          newDirY = Math.random() > 0.5 ? 1 : -1;
        }

        setDirection({ x: newDirX, y: newDirY });
        return { x: newX, y: newY };
      });
    }, 40);

    const bounceInterval = setInterval(() => {
      setBounce((prev) => (prev + 1) % 360);
    }, 25);

    return () => {
      clearInterval(moveInterval);
      clearInterval(bounceInterval);
    };
  }, [direction]);

  const bounceOffset = Math.sin((bounce * Math.PI) / 180) * 5;
  const rotation = Math.sin((bounce * Math.PI) / 90) * 6;

  return (
    <div
      className="absolute transition-all duration-75 ease-linear pointer-events-none"
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: `translate(-50%, -50%) translateY(${bounceOffset}px) rotate(${rotation}deg)`,
      }}
    >
      <svg className="w-20 h-20 drop-shadow-lg" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="60" cy="60" r="54" fill="url(#mascotBgBounceLoading)"/>
        <path
          d="M18 60 Q25 42 32 60 Q39 78 46 60 Q53 42 60 60 Q67 78 74 60 Q81 42 88 60 Q95 78 102 60"
          stroke="url(#waveGradBounceLoading)"
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="52" cy="52" r="5" fill="#e0e0e0"/>
        <circle cx="68" cy="52" r="5" fill="#e0e0e0"/>
        <circle cx="53.5" cy="53.5" r="2.5" fill="#1a1a1a"/>
        <circle cx="69.5" cy="53.5" r="2.5" fill="#1a1a1a"/>
        <circle cx="54.5" cy="52.5" r="1" fill="white" opacity="0.8"/>
        <circle cx="70.5" cy="52.5" r="1" fill="white" opacity="0.8"/>
        <path d="M52 70 Q60 77 68 70" stroke="#e0e0e0" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
        <line x1="60" y1="6" x2="60" y2="22" stroke="#808080" strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx="60" cy="5" r="3.5" fill="#a0a0a0"/>
        <circle cx="60" cy="5" r="6" fill="rgba(160,160,160,0.3)"/>
        <defs>
          <linearGradient id="waveGradBounceLoading" x1="18" y1="60" x2="102" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#505050"/>
            <stop offset="50%" stopColor="#808080"/>
            <stop offset="100%" stopColor="#505050"/>
          </linearGradient>
          <radialGradient id="mascotBgBounceLoading" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3a3a3a"/>
            <stop offset="100%" stopColor="#252525"/>
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}

export function SearchLoadingState() {
  return (
    <div className="relative min-h-[60vh]">
      {/* Bouncing mascot */}
      <div className="absolute inset-0 overflow-hidden">
        <BouncingMascot />
      </div>

      {/* Centered text content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-[60vh] pointer-events-none">
        <p className="text-3xl font-medium text-[#707070] flex items-center gap-1">
          Searching
          <span className="flex gap-1 ml-1">
            <span className="w-2 h-2 rounded-full bg-[#505050] animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-[#505050] animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-[#505050] animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        </p>
      </div>
    </div>
  );
}
