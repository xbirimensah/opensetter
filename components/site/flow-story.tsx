import type { ReactNode } from "react";
import { ChevronIcon } from "@/components/public-site-icons";
import { Avatar, DmButton, InBubble, Meta, OutBubble, Screen } from "@/components/site/chat";

/* The whole product in one strip: one comment, followed through to the
   moment the AI setter takes the conversation. Each frame is what the
   contact sees; the captions say what OpenSetter did. Example content. */

interface Frame {
  caption: string;
  title: ReactNode;
  body: ReactNode;
}

const frames: Frame[] = [
  {
    caption: "Someone comments MATRIX",
    title: "Comments",
    body: (
      <div className="flex flex-1 flex-col justify-end gap-3 p-3.5">
        <div className="flex items-start gap-2.5 opacity-60">
          <Avatar initial="J" />
          <p className="text-[0.8125rem] leading-snug">
            <span className="font-semibold">jordan.home</span>{" "}
            <span className="text-muted">Saving this</span>
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <Avatar initial="M" />
          <p className="text-[0.8125rem] leading-snug">
            <span className="font-semibold">maya.co</span>{" "}
            <span className="site-chip site-chip-accent ml-0.5 min-h-0 px-2 py-0.5">MATRIX</span>
          </p>
        </div>
      </div>
    ),
  },
  {
    caption: "A private reply with a button",
    title: "maya.co",
    body: (
      <div className="site-thread justify-end">
        <Meta align="end">Private reply</Meta>
        <OutBubble>
          Hey Maya, want the Matrix guide?
          <DmButton>Yes, send it</DmButton>
        </OutBubble>
      </div>
    ),
  },
  {
    caption: "It asks for an email",
    title: "maya.co",
    body: (
      <div className="site-thread justify-end">
        <InBubble>Yes, send it</InBubble>
        <OutBubble>Where should it go? Drop your email.</OutBubble>
        <InBubble>maya@example.com</InBubble>
      </div>
    ),
  },
  {
    caption: "It sends the tracked link",
    title: "maya.co",
    body: (
      <div className="site-thread justify-end">
        <OutBubble className="w-full max-w-none">
          Here it is.
          <span className="mt-2 block rounded-xl bg-black/20 px-3 py-2">
            <span className="block font-semibold">The Matrix guide</span>
            <span className="block truncate text-white/80">yourlink.com/matrix</span>
          </span>
        </OutBubble>
        <Meta align="end">Click tracked</Meta>
      </div>
    ),
  },
  {
    caption: "Your AI setter takes it from there",
    title: "maya.co",
    body: (
      <div className="site-thread justify-end">
        <InBubble>Does this work for coaches too?</InBubble>
        <Meta align="end">AI setter</Meta>
        <OutBubble>It does. What do you coach, and how do people find you today?</OutBubble>
      </div>
    ),
  },
];

export default function FlowStory() {
  return (
    <figure>
      <ol className="site-swipe lg:mx-0 lg:grid lg:grid-cols-5 lg:gap-6 lg:overflow-visible lg:px-0">
        {frames.map((frame, index) => (
          <li key={frame.caption} className="relative w-[15rem] lg:w-auto">
            <Screen title={frame.title} className="h-[15.5rem]">
              {frame.body}
            </Screen>
            <p className="mt-3 flex gap-2 text-[0.8125rem] font-medium leading-5">
              <span className="site-accent-text tabular-nums">{index + 1}</span>
              <span>{frame.caption}</span>
            </p>
            {index < frames.length - 1 && (
              <ChevronIcon className="absolute -right-[1.125rem] top-[7.25rem] hidden h-3 w-3 text-faint lg:block" />
            )}
          </li>
        ))}
      </ol>
      <figcaption className="sr-only">
        Example flow: a comment with the keyword MATRIX gets a private reply with
        a button, the flow asks for an email, sends a tracked link, then hands the
        conversation to the AI setter.
      </figcaption>
    </figure>
  );
}
