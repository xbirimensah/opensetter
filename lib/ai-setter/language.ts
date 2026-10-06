/**
 * Chat language matching, ported from wa-bridge's autoreply-language.
 *
 * Lexical and deterministic on purpose: the result feeds both the
 * prompt ("reply in German") and the final send gate, so a model cannot
 * talk its way past it.
 */

export type ChatLanguage = "de" | "en" | "pt" | "unknown";
type KnownLanguage = Exclude<ChatLanguage, "unknown">;

const KNOWN_LANGUAGES: readonly KnownLanguage[] = ["de", "en", "pt"];

export const LANGUAGE_NAMES: Record<KnownLanguage, string> = {
  de: "German",
  en: "English",
  pt: "Portuguese",
};

const LANGUAGE_WORDS: Record<KnownLanguage, ReadonlySet<string>> = {
  de: new Set([
    "aber", "alles", "auch", "bin", "bis", "bitte", "danke", "das", "dein", "deine",
    "dem", "den", "der", "die", "dir", "du", "ein", "eine", "für", "gerade", "habe",
    "hallo", "heute", "ich", "ist", "ja", "kann", "klar", "mal", "mir", "mit", "morgen",
    "nicht", "noch", "oder", "passt", "schon", "später", "und", "was", "wie", "wir", "zu",
  ]),
  en: new Set([
    "and", "are", "can", "cool", "easy", "for", "great", "hey", "i", "is", "it", "me",
    "please", "see", "thanks", "that", "the", "this", "tomorrow", "we", "what", "with",
    "yes", "you", "your",
  ]),
  pt: new Set([
    "beleza", "então", "isso", "não", "obrigada", "obrigado", "oi", "olá", "pois",
    "sim", "tá", "tudo", "bem", "você", "voce",
  ]),
};

/** Words that betray a language switch even inside a short reply. */
const OFF_LANGUAGE_FILLERS: Record<KnownLanguage, ReadonlySet<string>> = {
  de: new Set(["ja", "klar", "passt"]),
  en: new Set(["cool", "easy", "great", "yes"]),
  pt: new Set(["beleza", "então", "isso", "obrigada", "obrigado", "pois", "sim", "tá"]),
};

function words(text: string): string[] {
  // Normalize first so case, full-width characters, or punctuation cannot
  // dodge the lexical rules.
  return text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}]+/gu) ?? [];
}

export function detectTextLanguage(text: string): ChatLanguage {
  const tokens = words(text);
  if (tokens.length === 0) return "unknown";
  const scores: Record<KnownLanguage, number> = { de: 0, en: 0, pt: 0 };
  for (const token of tokens) {
    for (const language of KNOWN_LANGUAGES) {
      if (LANGUAGE_WORDS[language].has(token)) scores[language] += 1;
    }
  }
  if (/[äöüß]/i.test(text)) scores.de += 2;
  if (/[ãõáéíóúç]/i.test(text)) scores.pt += 2;
  const ranked = KNOWN_LANGUAGES.map(
    (language) => [language, scores[language]] as const
  ).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === 0 || ranked[0][1] === ranked[1][1]) return "unknown";
  return ranked[0][0];
}

/**
 * The chat's language: the incoming message when it is clear, otherwise
 * what the owner has been writing in this chat.
 */
export function resolveChatLanguage(
  incomingText: string,
  recentOwnerReplies: readonly string[]
): ChatLanguage {
  const incoming = detectTextLanguage(incomingText);
  if (incoming !== "unknown") return incoming;
  return detectTextLanguage(recentOwnerReplies.slice(-20).join("\n"));
}

/** Map the config's forced language ("German"/"English") to a code. */
export function languageFromSetting(
  setting: string | null | undefined
): KnownLanguage | null {
  const value = setting?.trim().toLowerCase();
  if (!value) return null;
  const match = KNOWN_LANGUAGES.find(
    (language) =>
      language === value || LANGUAGE_NAMES[language].toLowerCase() === value
  );
  return match ?? null;
}

export function findOffLanguageFillers(
  text: string,
  targetLanguage: ChatLanguage
): string[] {
  if (targetLanguage === "unknown") return [];
  const found = new Set<string>();
  for (const token of words(text)) {
    for (const language of KNOWN_LANGUAGES) {
      if (language !== targetLanguage && OFF_LANGUAGE_FILLERS[language].has(token)) {
        found.add(token);
      }
    }
  }
  return [...found];
}

export function isReplyLanguageCompatible(
  text: string,
  targetLanguage: ChatLanguage
): boolean {
  if (targetLanguage === "unknown" || !text.trim()) return true;
  if (findOffLanguageFillers(text, targetLanguage).length > 0) return false;
  const detected = detectTextLanguage(text);
  if (detected === "unknown" || detected === targetLanguage) return true;
  // Two-word replies are too short to judge reliably.
  return words(text).length < 3;
}
