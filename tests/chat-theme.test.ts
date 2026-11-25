import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBubbleGradientCss,
  buildChatBackgroundCss,
  CHAT_THEME_PRESETS,
  getBubbleInkPalette,
  getContrastRatio,
  isBackgroundDark,
  normalizeHexColor,
  parseChatThemeJson,
  sanitizeAngle,
  sanitizeChatTheme,
} from '../src/lib/chat-theme.ts';

describe('Per-Chat Theme Utilities', () => {
  test('all curated presets pass strict sanitization and produce valid CSS gradients', () => {
    assert.ok(CHAT_THEME_PRESETS.length >= 6);
    for (const preset of CHAT_THEME_PRESETS) {
      const sanitized = sanitizeChatTheme(preset.config);
      assert.ok(sanitized, `Preset ${preset.id} should sanitize cleanly`);
      assert.equal(sanitized.presetId, preset.id);
      const bgCss = buildChatBackgroundCss(sanitized);
      const bubbleCss = buildBubbleGradientCss(sanitized);
      assert.ok(bgCss.includes('linear-gradient('));
      assert.ok(bgCss.includes(sanitized.backgroundStart));
      assert.ok(bubbleCss.includes('linear-gradient('));
      assert.ok(bubbleCss.includes(sanitized.outgoingBubbleStart));
    }
  });

  test('normalizeHexColor expands shorthand and rejects unsafe CSS values', () => {
    assert.equal(normalizeHexColor('#AbC'), '#aabbcc');
    assert.equal(normalizeHexColor('  #7C5CF6  '), '#7c5cf6');
    assert.equal(normalizeHexColor('red'), null);
    assert.equal(normalizeHexColor('url(javascript:alert(1))'), null);
    assert.equal(normalizeHexColor('#12345'), null);
    assert.equal(normalizeHexColor('#zzzzzz'), null);
  });

  test('sanitizeAngle normalizes arbitrary finite angles to 0..359 and rejects NaN', () => {
    assert.equal(sanitizeAngle(-45), 315);
    assert.equal(sanitizeAngle(405), 45);
    assert.equal(sanitizeAngle(135.4), 135);
    assert.equal(sanitizeAngle(Number.NaN, 140), 140);
  });

  test('sanitizeChatTheme strips invalid tints/presets and rejects malformed color inputs', () => {
    assert.equal(
      sanitizeChatTheme({
        presetId: 'custom',
        backgroundStart: 'not-a-color',
        backgroundEnd: '#112233',
        outgoingBubbleStart: '#445566',
        outgoingBubbleEnd: '#778899',
      }),
      null
    );

    const cleaned = sanitizeChatTheme({
      presetId: 'invalid preset name!',
      backgroundStart: '#112233',
      backgroundVia: '#456',
      backgroundEnd: '#000',
      backgroundAngle: 725,
      outgoingBubbleStart: '#FBCFE8',
      outgoingBubbleEnd: '#C4B5FD',
      outgoingAngle: -30,
      incomingBubbleTint: 'malicious-value',
    });

    assert.ok(cleaned);
    assert.equal(cleaned.presetId, 'custom');
    assert.equal(cleaned.backgroundStart, '#112233');
    assert.equal(cleaned.backgroundVia, '#445566');
    assert.equal(cleaned.backgroundEnd, '#000000');
    assert.equal(cleaned.backgroundAngle, 5);
    assert.equal(cleaned.outgoingAngle, 330);
    assert.equal(cleaned.incomingBubbleTint, 'glass-default');
  });

  test('getBubbleInkPalette chooses dark slate ink for light pastel gradients and white ink for deep gradients', () => {
    const lightInk = getBubbleInkPalette('#fbcfe8', '#c4b5fd');
    assert.equal(lightInk.isLightSurface, true);
    assert.equal(lightInk.textColor, '#0f172a');
    assert.ok(getContrastRatio('#fbcfe8', lightInk.textColor) >= 4.5);

    const darkInk = getBubbleInkPalette('#8b5cf6', '#4f46e5');
    assert.equal(darkInk.isLightSurface, false);
    assert.equal(darkInk.textColor, '#ffffff');
    assert.ok(getContrastRatio('#4f46e5', darkInk.textColor) >= 4.5);
  });

  test('isBackgroundDark distinguishes dark obsidian gradients from airy light gradients', () => {
    const nebula = CHAT_THEME_PRESETS.find((p) => p.id === 'nebula-dusk')!;
    const rose = CHAT_THEME_PRESETS.find((p) => p.id === 'rose-quartz-dawn')!;
    assert.equal(isBackgroundDark(nebula.config), true);
    assert.equal(isBackgroundDark(rose.config), false);
  });

  test('parseChatThemeJson handles invalid JSON and returns null safely', () => {
    assert.equal(parseChatThemeJson('{bad json'), null);
    assert.equal(parseChatThemeJson(null), null);
    const validJson = JSON.stringify(CHAT_THEME_PRESETS[1].config);
    const parsed = parseChatThemeJson(validJson);
    assert.equal(parsed?.presetId, 'bioluminescent-tide');
  });
});
