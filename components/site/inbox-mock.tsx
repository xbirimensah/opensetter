import { Avatar, DmButton, InBubble, Meta } from "@/components/site/chat";

/* The inbox, drawn: a conversation list and one thread with the message
   kinds Instagram sends (voice note, card, text). Example content. */

const conversations = [
  { initial: "M", handle: "maya.co", preview: "Voice message", active: true },
  { initial: "J", handle: "jordan.home", preview: "Sent a photo", active: false },
  { initial: "S", handle: "sam.fit", preview: "AI draft waiting for review", active: false },
];

/* Fixed bar heights so the waveform renders the same on server and client. */
const waveform = [6, 10, 16, 9, 14, 20, 12, 7, 15, 18, 11, 6, 13, 17, 9, 5, 11, 14, 8, 6];

function VoiceNote() {
  return (
    <div className="site-bubble site-bubble-in flex items-center gap-2.5 py-2">
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foreground text-background"
        aria-hidden="true"
      >
        <svg viewBox="0 0 12 12" className="ml-0.5 h-2.5 w-2.5 fill-current">
          <path d="M2 1.2v9.6c0 .5.5.8.9.5l7.4-4.8a.6.6 0 000-1L2.9.7C2.5.4 2 .7 2 1.2z" />
        </svg>
      </span>
      <span className="flex h-5 items-center gap-[2px]" aria-hidden="true">
        {waveform.map((h, i) => (
          <span
            key={i}
            className={`w-[2px] rounded-full ${i < 7 ? "bg-foreground" : "bg-faint"}`}
            style={{ height: `${h}px` }}
          />
        ))}
      </span>
      <span className="text-[0.75rem] tabular-nums text-muted">0:14</span>
      <span className="sr-only">Voice message, 14 seconds</span>
    </div>
  );
}

function Card() {
  return (
    <div className="site-bubble site-bubble-out w-56 overflow-hidden p-0">
      <div className="grid h-24 place-items-center bg-black/25" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-7 w-7 text-white/70" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <circle cx="9" cy="10" r="1.75" />
          <path d="M4 17l4.5-4.5 3.5 3.5 2.5-2.5L20 19" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="px-3 pb-3 pt-2.5">
        <p className="font-semibold">Matrix starter kit</p>
        <p>Three lessons and a checklist</p>
        <DmButton>Open the kit</DmButton>
      </div>
    </div>
  );
}

export default function InboxMock() {
  return (
    <figure className="site-screen md:grid md:grid-cols-[15rem_1fr]">
      <ul className="hidden border-r border-border md:block" aria-label="Conversations">
        {conversations.map((c) => (
          <li
            key={c.handle}
            className={`flex items-center gap-3 border-b border-border px-4 py-3.5 ${
              c.active ? "bg-surface-hover" : ""
            }`}
          >
            <Avatar initial={c.initial} />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-semibold">{c.handle}</span>
              <span className="block truncate text-[0.75rem] text-muted">{c.preview}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex min-h-[22rem] flex-col">
        <div className="site-screen-bar">
          <Avatar initial="M" />
          <span className="flex-1">maya.co</span>
          <span className="site-chip min-h-6 px-2 text-[0.6875rem] font-medium text-muted">AI setter on</span>
        </div>
        <div className="site-thread justify-end gap-2 p-4">
          <VoiceNote />
          <Meta align="end">Flow: Matrix guide</Meta>
          <Card />
          <InBubble>Got it. Can I start before the next session?</InBubble>
        </div>
      </div>
      <figcaption className="sr-only">
        Example inbox: a voice message from the contact, a card with a button sent
        by a flow, and a text reply.
      </figcaption>
    </figure>
  );
}
