/**
 * Read-aloud support.
 *
 * There is no server in this app, so pronunciation uses the browser's own speech
 * synthesis: nothing is downloaded, nothing leaves the device, and no account is
 * needed. The trade-off is that the available Japanese voices depend on the
 * browser and the operating system, and some environments (jsdom, bare Linux
 * setups, private windows) have no speech engine at all. A missing API is
 * therefore a normal case rather than an error: `speechSupported()` reports it
 * and the UI disables the 再生 control with an explanation instead of leaving a
 * button that appears to do nothing.
 */

export const SPEECH_LANG = "ja-JP";
/** Slightly slower than default: insurance terms arrive inside long compounds. */
export const SPEECH_RATE = 0.95;

export interface SpeakEvents {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

export function speechSupported(): boolean {
  return typeof globalThis.speechSynthesis?.speak === "function";
}

/**
 * The best Japanese voice available, or null when the browser should just use its
 * default. Voice lists are loaded asynchronously in most browsers, so a caller
 * that asks right after page load may get an empty array — that is why this
 * takes the list instead of hiding the lookup.
 */
export function pickJapaneseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const wanted = SPEECH_LANG.toLowerCase().replace("_", "-");
  const japanese = voices.filter((voice) => (voice.lang ?? "").toLowerCase().startsWith("ja"));
  if (!japanese.length) return null;
  return japanese.find((voice) => voice.lang.toLowerCase().replace("_", "-") === wanted) ?? japanese[0];
}

function availableVoices(): SpeechSynthesisVoice[] {
  try {
    return globalThis.speechSynthesis?.getVoices() ?? [];
  } catch {
    // Some engines throw while they are still initialising.
    return [];
  }
}

/**
 * Speak a Japanese string. Returns false when nothing could be started, so the
 * caller can disable its control instead of appearing to do nothing.
 */
export function speak(text: string, events: SpeakEvents = {}): boolean {
  const api = globalThis.speechSynthesis;
  const value = text.trim();
  if (!speechSupported() || !value) return false;

  try {
    // Cancel first: without this, rapid clicks queue up and overlap.
    api.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = SPEECH_LANG;
    utterance.rate = SPEECH_RATE;
    const voice = pickJapaneseVoice(availableVoices());
    if (voice) utterance.voice = voice;

    let ended = false;
    let failed = false;
    utterance.onstart = () => events.onStart?.();
    utterance.onend = () => {
      ended = true;
      events.onEnd?.();
    };
    utterance.onerror = () => {
      failed = true;
      events.onError?.();
      // Callers only need one "finished" signal, however it ended.
      if (!ended) events.onEnd?.();
    };
    api.speak(utterance);
    // A real browser reports errors asynchronously, so this stays true; a speech
    // engine that fails immediately lets the caller know nothing was spoken.
    return !failed;
  } catch {
    return false;
  }
}

export function cancelSpeech(): void {
  try {
    globalThis.speechSynthesis?.cancel();
  } catch {
    /* nothing was speaking */
  }
}