import { useEffect, useState } from "react";
import { cancelSpeech, speak, speechSupported } from "../lib/speech";

interface Props {
  /** The Japanese text to read out (a term, or a full example sentence). */
  text: string;
  /** Accessible name for the control. */
  label?: string;
  /** Visible label. */
  short?: string;
  disabled?: boolean;
}

/**
 * 再生 / read-aloud button.
 *
 * When the browser has no speech engine the button stays visible but disabled,
 * with an explanation in its tooltip: a control the user can see and ask about
 * is friendlier than one that silently disappears.
 */
export default function SpeakButton({ text, label = "再生 / read aloud", short = "🔊 再生", disabled = false }: Props) {
  const supported = speechSupported();
  const [speaking, setSpeaking] = useState(false);

  // Never leave the previous phrase talking over the next question.
  useEffect(() => () => cancelSpeech(), [text]);

  return (
    <button
      type="button"
      className={`speak-btn ${speaking ? "is-speaking" : ""}`}
      aria-label={label}
      title={
        supported
          ? label
          : `${label} — このブラウザは音声合成に対応していません / this browser has no speech engine`
      }
      disabled={disabled || !text.trim() || !supported}
      onClick={() => {
        setSpeaking(true);
        const started = speak(text, {
          onStart: () => setSpeaking(true),
          onEnd: () => setSpeaking(false),
        });
        if (!started) setSpeaking(false);
      }}
    >
      {short}
    </button>
  );
}

export function stopSpeech(): void {
  cancelSpeech();
}