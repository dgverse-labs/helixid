// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

// Inline stroke icons (no icon dependency for four glyphs). Purely
// decorative — every usage sits next to a text label.

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function BotIcon() {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps}>
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 8V5m0 0h.01M9 13h.01M15 13h.01M9.5 16.5h5" />
      <path d="M2 12v3M22 12v3" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps}>
      <path d="M12 3l7 3v5c0 4.4-3 8.4-7 9.5C8 19.4 5 15.4 5 11V6l7-3z" />
      <path d="M9.5 11.6l1.8 1.8 3.4-3.6" />
    </svg>
  );
}

export function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps}>
      <path d="M3 12h4l2.5-6.5L14 18l2.5-6H21" />
    </svg>
  );
}

export function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" {...strokeProps}>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 11l8.5-8.5M16 5l3 3M13.5 7.5l3 3" />
    </svg>
  );
}
