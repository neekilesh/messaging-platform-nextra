import React from 'react';

export function NexoraLogo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="nexoraGradA" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="55%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#22D3EE" />
        </linearGradient>
        <linearGradient id="nexoraGradB" x1="16" y1="52" x2="48" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill="#0F1428" stroke="url(#nexoraGradA)" strokeWidth="2" />
      <path
        d="M20 44V20L44 44V20"
        stroke="url(#nexoraGradB)"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="3" fill="#22D3EE" />
      <circle cx="44" cy="44" r="3" fill="#A78BFA" />
    </svg>
  );
}
