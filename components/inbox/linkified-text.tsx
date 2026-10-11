import { linkify } from "@/lib/inbox/display";

/** Message text with line breaks kept and http(s) URLs as links. */
export default function LinkifiedText({ text, fromMe }: { text: string; fromMe: boolean }) {
  const tokens = linkify(text);
  return (
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {tokens.map((token, i) =>
        token.type === "link" ? (
          <a
            key={i}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline underline-offset-2 ${
              fromMe ? "decoration-white/60 hover:decoration-white" : "text-accent decoration-accent/40 hover:decoration-accent"
            }`}
          >
            {token.value}
          </a>
        ) : (
          <span key={i}>{token.value}</span>
        )
      )}
    </p>
  );
}
