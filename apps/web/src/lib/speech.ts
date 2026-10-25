import type {ReaderPreferences} from '@rumiai/contracts/accounts/preferences';
/**
 * Reading a reply aloud, using the browser's own speech synthesis.
 *
 * No backend and no provider quota: the voices ship with the operating system. That also
 * means Chinese voice availability varies by machine, so this degrades to "no sound" rather
 * than reading Chinese text with an English voice, which is unintelligible.
 */

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickChineseVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'zh-CN') ?? voices.find((v) => v.lang.startsWith('zh')) ?? null;
}

/**
 * Speaks `text`, returning whether it started. `onEnd` fires when it finishes or is
 * cancelled, so the caller can clear its "now speaking" state either way.
 */
export function speak(text: string, onEnd?: () => void, rate: ReaderPreferences['speechRate'] = 1, onError?: () => void): boolean {
  if (!speechSupported() || !text.trim()) return false;

  // Anything already queued is a previous message; keep only one voice at a time.
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  const voice = pickChineseVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => {onEnd?.(); onError?.();};

  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

export function pauseSpeaking(): void {if (speechSupported()) window.speechSynthesis.pause();}
export function resumeSpeaking(): void {if (speechSupported()) window.speechSynthesis.resume();}
