import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audioManager } from '../src/audio/AudioManager.ts';
import {
  DEFAULT_SOUND_SETTINGS,
  getProfilePatch,
  getSoundThemeMeta,
  mergeCategoryThemes,
  NEXORA_SOUND_PACKS,
  NEXORA_SOUND_PROFILES,
  NEXORA_SOUND_THEMES,
  NOTIFICATION_CATEGORIES,
} from '../src/audio/SoundSettings.ts';
import { adaptPlaybackPattern, SIGNATURE_PREVIEW_EVENTS, SOUND_REGISTRY } from '../src/audio/SoundRegistry.ts';

describe('NEXORA Audio System configuration', () => {
  it('defines 5 sound packs, 4 sound profiles, and 3 predefined category sound themes', () => {
    assert.equal(NEXORA_SOUND_PACKS.length, 5);
    assert.equal(NEXORA_SOUND_PROFILES.length, 4);
    assert.equal(NEXORA_SOUND_THEMES.length, 3);
    assert.deepEqual(
      NEXORA_SOUND_THEMES.map((t) => t.id),
      ['magical', 'balanced', 'minimal']
    );
    assert.equal(NOTIFICATION_CATEGORIES.length, 6);
    assert.equal(SIGNATURE_PREVIEW_EVENTS.length, 5);
  });

  it('registers all 5 signature preview events in SOUND_REGISTRY', () => {
    for (const sig of SIGNATURE_PREVIEW_EVENTS) {
      const def = SOUND_REGISTRY[sig.id];
      assert.ok(def, `Missing registry entry for ${sig.id}`);
      assert.ok(def.steps.length > 0, `Empty tone steps for ${sig.id}`);
    }
  });

  it('produces valid profile patches including soundTheme and categoryThemes for magical, balanced, minimal, and silent', () => {
    const magical = { ...DEFAULT_SOUND_SETTINGS, ...getProfilePatch('magical') };
    assert.equal(magical.masterEnabled, true);
    assert.equal(magical.uiEnabled, true);
    assert.equal(magical.storiesEnabled, true);
    assert.equal(magical.soundTheme, 'magical');
    assert.equal(magical.categoryThemes.messages, 'magical');
    assert.equal(magical.categoryThemes.notifications, 'magical');

    const balanced = { ...DEFAULT_SOUND_SETTINGS, ...getProfilePatch('balanced') };
    assert.equal(balanced.masterEnabled, true);
    assert.equal(balanced.uiEnabled, false);
    assert.equal(balanced.messagesEnabled, true);
    assert.equal(balanced.soundTheme, 'balanced');
    assert.equal(balanced.categoryThemes.notifications, 'balanced');

    const minimal = { ...DEFAULT_SOUND_SETTINGS, ...getProfilePatch('minimal') };
    assert.equal(minimal.masterEnabled, true);
    assert.equal(minimal.messagesEnabled, true);
    assert.equal(minimal.achievementsEnabled, false);
    assert.equal(minimal.soundTheme, 'minimal');
    assert.equal(minimal.categoryThemes.messages, 'minimal');

    const silent = { ...DEFAULT_SOUND_SETTINGS, ...getProfilePatch('silent') };
    assert.equal(silent.masterEnabled, false);
  });

  it('safely merges partial or invalid categoryThemes with fallback defaults', () => {
    const merged = mergeCategoryThemes(
      {
        messages: 'minimal',
        notifications: 'balanced',
        stories: 'invalid-theme',
      } as Record<string, unknown>,
      'magical'
    );
    assert.equal(merged.messages, 'minimal');
    assert.equal(merged.notifications, 'balanced');
    assert.equal(merged.stories, 'magical');
    assert.equal(merged.achievements, 'magical');
    assert.equal(getSoundThemeMeta('minimal').name, 'Minimal');
  });

  it('dynamically adapts playback step patterns for Magical, Balanced, and Minimal themes', () => {
    const baseSteps = SOUND_REGISTRY['notify.private'].steps; // 3 steps
    const magicalSteps = adaptPlaybackPattern(baseSteps, 'magical');
    const balancedSteps = adaptPlaybackPattern(baseSteps, 'balanced');
    const minimalSteps = adaptPlaybackPattern(baseSteps, 'minimal');

    assert.equal(magicalSteps.length, baseSteps.length + 1); // adds shimmer tail
    assert.equal(balancedSteps.length, 3);
    assert.equal(minimalSteps.length, 2); // condensed pattern
    assert.ok(minimalSteps[0].duration < balancedSteps[0].duration);
    assert.ok(balancedSteps[0].duration < magicalSteps[0].duration);
    assert.equal(minimalSteps[0].wave, 'sine');
  });

  it('updates AudioManager internal settings when switching between Magical, Minimal, and Balanced themes', () => {
    audioManager.setSoundTheme('minimal');
    assert.equal(audioManager.getSoundTheme(), 'minimal');
    assert.equal(audioManager.getSettings().soundTheme, 'minimal');
    assert.equal(audioManager.getSettings().categoryThemes.notifications, 'minimal');

    audioManager.setSoundTheme('balanced');
    assert.equal(audioManager.getSoundTheme(), 'balanced');
    assert.equal(audioManager.getSettings().categoryThemes.messages, 'balanced');

    audioManager.setSoundTheme('magical');
    assert.equal(audioManager.getSoundTheme(), 'magical');
    assert.equal(audioManager.getSettings().categoryThemes.ui, 'magical');
  });
});
