import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audioManager, globalSoundManager } from '../src/audio/GlobalSoundManager.ts';
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
import { adaptPlaybackPattern, SIGNATURE_PREVIEW_EVENTS, SOUND_REGISTRY, type SoundEventId } from '../src/audio/SoundRegistry.ts';

describe('NEXORA Audio System & GlobalSoundManager', () => {
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

  it('registers all required specification sound events in SOUND_REGISTRY', () => {
    const requiredEvents: SoundEventId[] = [
      'message.send', // Sending a text message: Soft outgoing message pop
      'message.receive', // Receiving a text message: Gentle incoming message notification
      'message.delivered', // Message successfully delivered: Subtle delivery confirmation
      'message.read', // Message read: Very subtle read confirmation, if enabled
      'ui.click', // Button click: Soft tactile click
      'ui.tab_switch', // Switching navigation tabs: Short transition sound
      'ui.chat_open', // Opening a chat: Gentle glass-like opening sound
      'ui.chat_close', // Closing a chat: Soft closing sound
      'ui.feature_open', // Opening a feature: Subtle magical transition
      'voice.send', // Sending a voice message: Soft send confirmation
      'voice.receive', // Receiving a voice message: Incoming message notification
      'media.upload_start', // Uploading media: Subtle upload start sound
      'media.upload_success', // Media upload completed: Bright confirmation chime
    ];

    for (const id of requiredEvents) {
      const def = SOUND_REGISTRY[id];
      assert.ok(def, `Missing registry entry for ${id}`);
      assert.ok(def.steps.length > 0, `Empty tone steps for ${id}`);
      assert.ok(def.cooldownMs >= 0, `Invalid cooldown for ${id}`);
    }
  });

  it('produces valid profile patches with uiEnabled preserved across magical, balanced, and minimal', () => {
    const magical = { ...DEFAULT_SOUND_SETTINGS, ...getProfilePatch('magical') };
    assert.equal(magical.masterEnabled, true);
    assert.equal(magical.uiEnabled, true);
    assert.equal(magical.storiesEnabled, true);
    assert.equal(magical.soundTheme, 'magical');
    assert.equal(magical.categoryThemes.messages, 'magical');
    assert.equal(magical.categoryThemes.notifications, 'magical');

    const balanced = { ...DEFAULT_SOUND_SETTINGS, ...getProfilePatch('balanced') };
    assert.equal(balanced.masterEnabled, true);
    assert.equal(balanced.uiEnabled, true); // Verified: UI sounds are active in balanced
    assert.equal(balanced.messagesEnabled, true);
    assert.equal(balanced.soundTheme, 'balanced');
    assert.equal(balanced.categoryThemes.notifications, 'balanced');

    const minimal = { ...DEFAULT_SOUND_SETTINGS, ...getProfilePatch('minimal') };
    assert.equal(minimal.masterEnabled, true);
    assert.equal(minimal.uiEnabled, true); // Verified: UI clicks can play in minimal
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

  it('GlobalSoundManager provides dedicated helper methods without crashing', () => {
    assert.equal(globalSoundManager, audioManager);

    // Call all dedicated helpers safely (headless / SSR safe)
    globalSoundManager.playMessageSend();
    globalSoundManager.playMessageReceive(false);
    globalSoundManager.playMessageReceive(true);
    globalSoundManager.playMessageDelivered();
    globalSoundManager.playMessageRead();
    globalSoundManager.playButtonClick();
    globalSoundManager.playTabSwitch();
    globalSoundManager.playChatOpen();
    globalSoundManager.playChatClose();
    globalSoundManager.playFeatureOpen();
    globalSoundManager.playVoiceSend();
    globalSoundManager.playVoiceReceive();
    globalSoundManager.playMediaUploadStart();
    globalSoundManager.playMediaUploadCompleted();

    assert.ok(true, 'All dedicated sound methods executed cleanly');
  });

  it('GlobalSoundManager controls volume and mute state correctly', () => {
    globalSoundManager.setVolume(0.85);
    assert.equal(globalSoundManager.getVolume(), 0.85);

    globalSoundManager.setMasterEnabled(false);
    assert.equal(globalSoundManager.isMuted(), true);

    globalSoundManager.setMasterEnabled(true);
    assert.equal(globalSoundManager.isMuted(), false);

    // Voice recording safety check
    globalSoundManager.setVoiceRecordingActive(true);
    assert.equal(globalSoundManager.isVoiceRecordingActive(), true);
    globalSoundManager.setVoiceRecordingActive(false);
    assert.equal(globalSoundManager.isVoiceRecordingActive(), false);
  });

  it('provides accurate audio diagnostics snapshot and playDiagnostic blocking reasons', async () => {
    globalSoundManager.resetDiagnosticsState();
    globalSoundManager.setMasterEnabled(false);
    const mutedSnap = globalSoundManager.getDiagnostics();
    assert.equal(mutedSnap.isMuted, true);
    assert.equal(mutedSnap.totalRegisteredSounds, Object.keys(SOUND_REGISTRY).length);
    assert.equal(mutedSnap.targetGainValue, 0);

    const blockedRes = await globalSoundManager.playDiagnostic('message.send', { bypassFilters: false });
    assert.equal(blockedRes.played, false);
    assert.equal(blockedRes.reason, 'muted');

    globalSoundManager.setMasterEnabled(true);
    globalSoundManager.setVolume(0.5);
    const activeSnap = globalSoundManager.getDiagnostics();
    assert.equal(activeSnap.isMuted, false);
    assert.equal(activeSnap.effectiveVolume, 0.5);
    assert.equal(activeSnap.targetGainValue, 0.225);
    assert.equal(globalSoundManager.getEventBlockingReason('message.send'), null);
  });
});
