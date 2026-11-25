export type IncomingBubbleTint = 'glass-default' | 'frosted-light' | 'frosted-dark' | 'warm-silk';

export interface ChatThemeConfig {
  presetId: string;
  backgroundStart: string;
  backgroundVia?: string;
  backgroundEnd: string;
  backgroundAngle: number;
  outgoingBubbleStart: string;
  outgoingBubbleEnd: string;
  outgoingAngle: number;
  incomingBubbleTint?: IncomingBubbleTint;
  updatedAt?: string;
}

export interface ChatThemePreset {
  id: string;
  name: string;
  description: string;
  config: ChatThemeConfig;
}

export interface BubbleInkPalette {
  isLightSurface: boolean;
  textColor: '#ffffff' | '#0f172a';
  mutedTextColor: string;
  subSurfaceBg: string;
  subSurfaceHoverBg: string;
  borderColor: string;
  accentColor: string;
  checkSentColor: string;
  checkReadColor: string;
}

const ALLOWED_INCOMING_TINTS: ReadonlySet<IncomingBubbleTint> = new Set([
  'glass-default',
  'frosted-light',
  'frosted-dark',
  'warm-silk',
]);

export const CHAT_THEME_PRESETS: ChatThemePreset[] = [
  {
    id: 'nebula-dusk',
    name: 'Nebula Dusk',
    description: 'Deep cosmic violet backdrop with electric indigo bubbles.',
    config: {
      presetId: 'nebula-dusk',
      backgroundStart: '#140b2e',
      backgroundVia: '#22144a',
      backgroundEnd: '#0d1b3a',
      backgroundAngle: 145,
      outgoingBubbleStart: '#8b5cf6',
      outgoingBubbleEnd: '#4f46e5',
      outgoingAngle: 135,
      incomingBubbleTint: 'frosted-dark',
    },
  },
  {
    id: 'bioluminescent-tide',
    name: 'Bioluminescent Tide',
    description: 'Abyssal ocean slate paired with luminous cyan-cobalt glass.',
    config: {
      presetId: 'bioluminescent-tide',
      backgroundStart: '#061a24',
      backgroundVia: '#0b2f3f',
      backgroundEnd: '#0d1a38',
      backgroundAngle: 152,
      outgoingBubbleStart: '#0891b2',
      outgoingBubbleEnd: '#2563eb',
      outgoingAngle: 135,
      incomingBubbleTint: 'frosted-dark',
    },
  },
  {
    id: 'rose-quartz-dawn',
    name: 'Rose Quartz Dawn',
    description: 'Airy blush-to-sky pastel canvas with vibrant berry-violet bubbles.',
    config: {
      presetId: 'rose-quartz-dawn',
      backgroundStart: '#ffe4ec',
      backgroundVia: '#f3d9fa',
      backgroundEnd: '#dbeafe',
      backgroundAngle: 138,
      outgoingBubbleStart: '#db2777',
      outgoingBubbleEnd: '#7c3aed',
      outgoingAngle: 135,
      incomingBubbleTint: 'frosted-light',
    },
  },
  {
    id: 'emerald-aurora',
    name: 'Emerald Aurora',
    description: 'Northern lights spruce gradient with crisp jade-azure bubbles.',
    config: {
      presetId: 'emerald-aurora',
      backgroundStart: '#06201a',
      backgroundVia: '#0b322c',
      backgroundEnd: '#0d1e36',
      backgroundAngle: 145,
      outgoingBubbleStart: '#059669',
      outgoingBubbleEnd: '#0284c7',
      outgoingAngle: 135,
      incomingBubbleTint: 'frosted-dark',
    },
  },
  {
    id: 'amber-ember',
    name: 'Amber Ember',
    description: 'Warm obsidian dusk contrasted by sunset tangerine-crimson.',
    config: {
      presetId: 'amber-ember',
      backgroundStart: '#1f0f0c',
      backgroundVia: '#331715',
      backgroundEnd: '#1c1029',
      backgroundAngle: 142,
      outgoingBubbleStart: '#ea580c',
      outgoingBubbleEnd: '#db2777',
      outgoingAngle: 135,
      incomingBubbleTint: 'frosted-dark',
    },
  },
  {
    id: 'pastel-silk',
    name: 'Pastel Silk',
    description: 'Soft sunlit cream-lavender backdrop with high-contrast pastel bubbles.',
    config: {
      presetId: 'pastel-silk',
      backgroundStart: '#fef3c7',
      backgroundVia: '#fce7f3',
      backgroundEnd: '#e0e7ff',
      backgroundAngle: 140,
      outgoingBubbleStart: '#fbcfe8',
      outgoingBubbleEnd: '#c4b5fd',
      outgoingAngle: 135,
      incomingBubbleTint: 'warm-silk',
    },
  },
];

export const DEFAULT_CUSTOM_CHAT_THEME: ChatThemeConfig = {
  ...CHAT_THEME_PRESETS[0].config,
  presetId: 'custom',
};

export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].toLowerCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

export function sanitizeAngle(input: unknown, fallback = 140): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback;
  return ((Math.round(input) % 360) + 360) % 360;
}

export function sanitizeChatTheme(raw: unknown): ChatThemeConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const backgroundStart = normalizeHexColor(obj.backgroundStart);
  const backgroundEnd = normalizeHexColor(obj.backgroundEnd);
  const outgoingBubbleStart = normalizeHexColor(obj.outgoingBubbleStart);
  const outgoingBubbleEnd = normalizeHexColor(obj.outgoingBubbleEnd);

  if (!backgroundStart || !backgroundEnd || !outgoingBubbleStart || !outgoingBubbleEnd) {
    return null;
  }

  let backgroundVia: string | undefined;
  if (obj.backgroundVia !== undefined && obj.backgroundVia !== null && obj.backgroundVia !== '') {
    const normalizedVia = normalizeHexColor(obj.backgroundVia);
    if (!normalizedVia) return null;
    backgroundVia = normalizedVia;
  }

  const rawPreset = typeof obj.presetId === 'string' ? obj.presetId.trim() : 'custom';
  const presetId =
    rawPreset && /^[a-zA-Z0-9_-]{1,64}$/.test(rawPreset) ? rawPreset : 'custom';

  const backgroundAngle = sanitizeAngle(obj.backgroundAngle, 145);
  const outgoingAngle = sanitizeAngle(obj.outgoingAngle, 135);

  const incomingBubbleTint =
    typeof obj.incomingBubbleTint === 'string' &&
    ALLOWED_INCOMING_TINTS.has(obj.incomingBubbleTint as IncomingBubbleTint)
      ? (obj.incomingBubbleTint as IncomingBubbleTint)
      : 'glass-default';

  const updatedAt =
    typeof obj.updatedAt === 'string' && obj.updatedAt.length <= 48
      ? obj.updatedAt
      : undefined;

  return {
    presetId,
    backgroundStart,
    ...(backgroundVia ? { backgroundVia } : {}),
    backgroundEnd,
    backgroundAngle,
    outgoingBubbleStart,
    outgoingBubbleEnd,
    outgoingAngle,
    incomingBubbleTint,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function parseChatThemeJson(rawJson: string | null | undefined): ChatThemeConfig | null {
  if (!rawJson || typeof rawJson !== 'string') return null;
  try {
    return sanitizeChatTheme(JSON.parse(rawJson));
  } catch {
    return null;
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(hex) || '#000000';
  const value = normalized.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const transform = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

export function getContrastRatio(hexA: string, hexB: string): number {
  const lumA = getRelativeLuminance(hexA);
  const lumB = getRelativeLuminance(hexB);
  const brightest = Math.max(lumA, lumB);
  const darkest = Math.min(lumA, lumB);
  return (brightest + 0.05) / (darkest + 0.05);
}

export function getBubbleInkPalette(startHex: string, endHex: string): BubbleInkPalette {
  const minContrastWithWhite = Math.min(
    getContrastRatio(startHex, '#ffffff'),
    getContrastRatio(endHex, '#ffffff')
  );
  const minContrastWithDark = Math.min(
    getContrastRatio(startHex, '#0f172a'),
    getContrastRatio(endHex, '#0f172a')
  );

  // Prefer crisp white ink unless dark slate provides noticeably better minimum contrast
  const isLightSurface = minContrastWithWhite < 3.6 && minContrastWithDark > minContrastWithWhite;

  if (isLightSurface) {
    return {
      isLightSurface: true,
      textColor: '#0f172a',
      mutedTextColor: 'rgba(15, 23, 42, 0.72)',
      subSurfaceBg: 'rgba(255, 255, 255, 0.56)',
      subSurfaceHoverBg: 'rgba(255, 255, 255, 0.76)',
      borderColor: 'rgba(15, 23, 42, 0.16)',
      accentColor: '#3730a3',
      checkSentColor: 'rgba(15, 23, 42, 0.65)',
      checkReadColor: '#0369a1',
    };
  }

  return {
    isLightSurface: false,
    textColor: '#ffffff',
    mutedTextColor: 'rgba(255, 255, 255, 0.82)',
    subSurfaceBg: 'rgba(0, 0, 0, 0.22)',
    subSurfaceHoverBg: 'rgba(0, 0, 0, 0.34)',
    borderColor: 'rgba(255, 255, 255, 0.34)',
    accentColor: '#bae6fd',
    checkSentColor: 'rgba(226, 232, 240, 0.86)',
    checkReadColor: '#67e8f9',
  };
}

export function isBackgroundDark(theme: ChatThemeConfig): boolean {
  const stops = [
    theme.backgroundStart,
    ...(theme.backgroundVia ? [theme.backgroundVia] : []),
    theme.backgroundEnd,
  ];
  const avgLum =
    stops.reduce((acc, hex) => acc + getRelativeLuminance(hex), 0) / stops.length;
  return avgLum < 0.32;
}

export function buildChatBackgroundCss(theme: ChatThemeConfig): string {
  const angle = sanitizeAngle(theme.backgroundAngle, 145);
  const stops = theme.backgroundVia
    ? `${theme.backgroundStart} 0%, ${theme.backgroundVia} 50%, ${theme.backgroundEnd} 100%`
    : `${theme.backgroundStart} 0%, ${theme.backgroundEnd} 100%`;

  const topGlow = hexToRgba(theme.outgoingBubbleStart, isBackgroundDark(theme) ? 0.16 : 0.14);
  const bottomGlow = hexToRgba(theme.outgoingBubbleEnd, isBackgroundDark(theme) ? 0.14 : 0.12);

  return [
    `radial-gradient(ellipse 75% 48% at 15% 6%, ${topGlow}, transparent 62%)`,
    `radial-gradient(ellipse 68% 45% at 88% 92%, ${bottomGlow}, transparent 60%)`,
    `linear-gradient(${angle}deg, ${stops})`,
  ].join(', ');
}

export function buildBubbleGradientCss(theme: ChatThemeConfig): string {
  const angle = sanitizeAngle(theme.outgoingAngle, 135);
  return `linear-gradient(${angle}deg, ${theme.outgoingBubbleStart} 0%, ${theme.outgoingBubbleEnd} 100%)`;
}

export function buildBubbleShadowCss(theme: ChatThemeConfig): string {
  return `inset 0 1.5px 1px rgba(255, 255, 255, 0.34), 0 8px 24px ${hexToRgba(
    theme.outgoingBubbleStart,
    0.26
  )}`;
}

export function getIncomingBubbleStyle(
  tint: IncomingBubbleTint | undefined
): {
  background?: string;
  borderColor?: string;
  color?: string;
  isDarkSurface?: boolean;
} {
  switch (tint) {
    case 'frosted-dark':
      return {
        background:
          'linear-gradient(142deg, rgba(255, 255, 255, 0.14) 0%, rgba(19, 24, 42, 0.82) 100%)',
        borderColor: 'rgba(255, 255, 255, 0.18)',
        color: '#f3f5ff',
        isDarkSurface: true,
      };
    case 'frosted-light':
      return {
        background:
          'linear-gradient(145deg, rgba(255, 255, 255, 0.86) 0%, rgba(255, 255, 255, 0.64) 100%)',
        borderColor: 'rgba(255, 255, 255, 0.82)',
        color: '#15172e',
        isDarkSurface: false,
      };
    case 'warm-silk':
      return {
        background:
          'linear-gradient(145deg, rgba(255, 250, 245, 0.88) 0%, rgba(253, 242, 233, 0.72) 100%)',
        borderColor: 'rgba(255, 245, 235, 0.86)',
        color: '#291d1a',
        isDarkSurface: false,
      };
    case 'glass-default':
    default:
      return {};
  }
}

export function getCachedChatTheme(userId: string, conversationId: string): ChatThemeConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`nexora_chat_theme:${userId}:${conversationId}`);
    return parseChatThemeJson(raw);
  } catch {
    return null;
  }
}

export function setCachedChatTheme(
  userId: string,
  conversationId: string,
  theme: ChatThemeConfig | null
): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `nexora_chat_theme:${userId}:${conversationId}`;
    if (!theme) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(theme));
    }
  } catch {
    // ignore storage quota failures
  }
}
