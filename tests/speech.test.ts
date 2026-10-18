import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cancelSpeech, pickJapaneseVoice, speak, speechSupported } from "../src/lib/speech";

/**
 * jsdom ships no Web Speech API at all, so the tests install a minimal stand-in
 * for `speechSynthesis` and `SpeechSynthesisUtterance` and observe what the
 * wrapper asks the browser to say.
 */
class FakeUtterance {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const JA_VOICE = { name: "Google 日本語", lang: "ja-JP" } as SpeechSynthesisVoice;
const EN_VOICE = { name: "Google US English", lang: "en-US" } as SpeechSynthesisVoice;

function installFakeSynthesis(voices: SpeechSynthesisVoice[], autoEnd = true) {
  const spoken: FakeUtterance[] = [];
  let cancelled = 0;
  const synthesis = {
    getVoices: () => voices,
    speak: (utterance: SpeechSynthesisUtterance) => {
      const fake = utterance as unknown as FakeUtterance;
      spoken.push(fake);
      fake.onstart?.();
      if (autoEnd) fake.onend?.();
    },
    cancel: () => {
      cancelled += 1;
    },
    pause: () => undefined,
    resume: () => undefined,
    paused: false,
    speaking: false,
    pending: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
    onvoiceschanged: null,
  } as unknown as SpeechSynthesis;

  Object.defineProperty(globalThis, "speechSynthesis", { value: synthesis, configurable: true, writable: true });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true, writable: true });
  return { spoken, cancelledCount: () => cancelled };
}

function removeFakeSynthesis() {
  Reflect.deleteProperty(globalThis, "speechSynthesis");
  Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
}

describe("speech support detection", () => {
  afterEach(() => removeFakeSynthesis());

  it("reports no support in an environment without the Web Speech API", () => {
    expect(speechSupported()).toBe(false);
    // Speaking and cancelling must both be safe no-ops rather than crashes.
    expect(speak("保険")).toBe(false);
    expect(() => cancelSpeech()).not.toThrow();
  });

  it("reports support once an implementation exists", () => {
    installFakeSynthesis([EN_VOICE, JA_VOICE]);
    expect(speechSupported()).toBe(true);
  });
});

describe("voice selection", () => {
  it("prefers an exact ja voice, then any voice whose language starts with ja", () => {
    expect(pickJapaneseVoice([EN_VOICE, JA_VOICE])).toBe(JA_VOICE);
    const kyoto = { name: "Kyoko", lang: "ja" } as SpeechSynthesisVoice;
    expect(pickJapaneseVoice([EN_VOICE, kyoto, JA_VOICE])).toBe(JA_VOICE);
    expect(pickJapaneseVoice([EN_VOICE, kyoto])).toBe(kyoto);
  });

  it("returns null when the browser has no Japanese voice", () => {
    expect(pickJapaneseVoice([EN_VOICE])).toBeNull();
    expect(pickJapaneseVoice([])).toBeNull();
  });
});

describe("speaking a term aloud", () => {
  beforeEach(() => removeFakeSynthesis());
  afterEach(() => removeFakeSynthesis());

  it("queues the text in Japanese with the Japanese voice and reports completion", () => {
    const { spoken } = installFakeSynthesis([EN_VOICE, JA_VOICE]);
    const events: string[] = [];
    const ok = speak("控除", { onStart: () => events.push("start"), onEnd: () => events.push("end") });

    expect(ok).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("控除");
    expect(spoken[0].lang).toBe("ja-JP");
    expect(spoken[0].voice).toBe(JA_VOICE);
    expect(spoken[0].rate).toBe(0.95);
    expect(events).toEqual(["start", "end"]);
  });

  it("cancels whatever is still being read before starting the next phrase", () => {
    const { spoken, cancelledCount } = installFakeSynthesis([JA_VOICE], false);
    speak("控除");
    speak("免責");
    expect(spoken.map((u) => u.text)).toEqual(["控除", "免責"]);
    // Every new phrase cancels first, so two calls mean two cancels.
    expect(cancelledCount()).toBe(2);
  });

  it("leaves the default voice in place when no Japanese voice is installed", () => {
    const { spoken } = installFakeSynthesis([EN_VOICE]);
    expect(speak("控除")).toBe(true);
    expect(spoken[0].voice).toBeNull();
    expect(spoken[0].lang).toBe("ja-JP");
  });

  it("reports failure when the browser refuses to speak", () => {
    const { spoken } = installFakeSynthesis([JA_VOICE]);
    const original = (globalThis.speechSynthesis as SpeechSynthesis).speak;
    Object.defineProperty(globalThis.speechSynthesis, "speak", {
      value: (utterance: SpeechSynthesisUtterance) => {
        spoken.push(utterance as unknown as FakeUtterance);
        (utterance as unknown as FakeUtterance).onerror?.();
      },
      configurable: true,
    });
    const events: string[] = [];
    expect(speak("控除", { onEnd: () => events.push("end"), onError: () => events.push("error") })).toBe(false);
    // onEnd is the single "finished" signal callers rely on, even after an error.
    expect(events).toEqual(["error", "end"]);
    Object.defineProperty(globalThis.speechSynthesis, "speak", { value: original, configurable: true });
  });
});
