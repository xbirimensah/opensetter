import { describe, expect, it } from "vitest";
import {
  DISALLOWED_LINK_REASON,
  extractLinks,
  findDisallowedLinks,
  normalizeAllowedHosts,
} from "@/lib/ai-setter/link-guard";
import { evaluateAutoSendSafety } from "@/lib/ai-setter/safety";

const draft = (reply: string) => ({ reply, confidence: 0.95, shouldSend: true, needsReview: false, reasons: [] });

describe("link guard", () => {
  it("finds scheme, www and bare-domain links", () => {
    expect(extractLinks("schau hier: https://cal.com/me/intro.")).toEqual(["https://cal.com/me/intro"]);
    expect(extractLinks("www.example.de/kurs oder calendly.com/x/30min")).toEqual([
      "www.example.de/kurs",
      "calendly.com/x/30min",
    ]);
  });

  it("ignores abbreviations, handles, emails and tech names", () => {
    expect(extractLinks("z.B. das hier, d.h. morgen")).toEqual([]);
    expect(extractLinks("folg @max.mustermann oder schreib an max@firma.de")).toEqual([]);
    expect(extractLinks("ich baue das mit Next.js und Node.js")).toEqual([]);
    expect(extractLinks("Klingt gut.Was machst du so")).toEqual([]);
  });

  it("normalizes allowlist entries to bare hosts", () => {
    expect(normalizeAllowedHosts(["https://cal.com/me", "Example.DE", "*.youtube.com", "www.site.io", "", "not a domain"])).toEqual([
      "cal.com",
      "example.de",
      "youtube.com",
      "site.io",
    ]);
  });

  it("allows the booking host, allowlisted domains and their subdomains", () => {
    const allowed = ["https://cal.com/me/intro", "youtube.com"];
    expect(findDisallowedLinks("buch dir hier was: https://cal.com/me/intro", allowed)).toEqual([]);
    expect(findDisallowedLinks("das video: https://m.youtube.com/watch?v=1 und youtube.com/@me", allowed)).toEqual([]);
    expect(findDisallowedLinks("hier: https://cal.com.evil.io/me", allowed)).toEqual(["https://cal.com.evil.io/me"]);
    expect(findDisallowedLinks("oder calendly.com/someone", allowed)).toEqual(["calendly.com/someone"]);
  });

  it("holds an auto-send draft with an invented link", () => {
    const check = evaluateAutoSendSafety({
      incomingText: "wo kann ich mehr sehen?",
      draft: draft("schau mal auf meine seite: https://my-coaching-site.com"),
      minConfidence: 0.78,
      allowedLinkHosts: ["https://cal.com/me"],
    });
    expect(check.allowed).toBe(false);
    expect(check.reasons).toContain(DISALLOWED_LINK_REASON);
  });

  it("lets the booking link through", () => {
    const check = evaluateAutoSendSafety({
      incomingText: "wie geht es weiter?",
      draft: draft("lass uns kurz sprechen, such dir hier was aus: https://cal.com/me"),
      minConfidence: 0.78,
      allowedLinkHosts: ["https://cal.com/me"],
    });
    expect(check.reasons).not.toContain(DISALLOWED_LINK_REASON);
  });

  it("holds any link when nothing is allowlisted", () => {
    const check = evaluateAutoSendSafety({
      incomingText: "hast du was dazu?",
      draft: draft("klar, lies das mal: medium.com/some-post"),
      minConfidence: 0.78,
    });
    expect(check.reasons).toContain(DISALLOWED_LINK_REASON);
  });
});
