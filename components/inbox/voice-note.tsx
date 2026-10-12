"use client";

/**
 * Instagram-style voice note: play/pause, a waveform you can scrub 1:1
 * with the pointer, elapsed/total time and 1x / 1.5x / 2x speed. Only one
 * voice note plays at a time.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/inbox/display";
import { MicIcon, PauseIcon, PlayIcon } from "@/components/inbox/icons";
import { PRESS } from "@/components/inbox/ui";

const BAR_COUNT = 32;
const SPEEDS = [1, 1.5, 2] as const;
const SEEK_STEP_SECONDS = 5;

/** The element currently playing, so starting another pauses it. */
let activeAudio: HTMLAudioElement | null = null;

/** Deterministic pseudo-waveform from the message id (no audio decoding). */
function waveform(seed: string): number[] {
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    const noise = (state % 1000) / 1000;
    const envelope = Math.sin((Math.PI * (i + 0.5)) / BAR_COUNT);
    return 0.25 + 0.75 * Math.max(0.15, noise * 0.6 + envelope * 0.4);
  });
}

interface VoiceNoteProps {
  src: string;
  seed: string;
  fromMe: boolean;
}

export default function VoiceNote({ src, seed, fromMe }: VoiceNoteProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fixingDurationRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const bars = useMemo(() => waveform(seed), [seed]);

  // Smooth progress while playing: timeupdate only fires ~4x a second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el) setCurrent(el.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (el && activeAudio === el) activeAudio = null;
    };
  }, []);

  const known = duration !== null && Number.isFinite(duration) && duration > 0;
  const progress = scrub ?? (known ? Math.min(1, current / (duration as number)) : 0);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      if (activeAudio && activeAudio !== el) activeAudio.pause();
      activeAudio = el;
      void el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  function fractionAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function seekTo(fraction: number) {
    const el = audioRef.current;
    if (!el || !known) return;
    el.currentTime = fraction * (duration as number);
    setCurrent(el.currentTime);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!known) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(fractionAt(e.clientX));
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (scrub === null) return;
    setScrub(fractionAt(e.clientX));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (scrub === null) return;
    seekTo(fractionAt(e.clientX));
    setScrub(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !known) return;
    const total = duration as number;
    const moves: Record<string, number> = {
      ArrowLeft: el.currentTime - SEEK_STEP_SECONDS,
      ArrowDown: el.currentTime - SEEK_STEP_SECONDS,
      ArrowRight: el.currentTime + SEEK_STEP_SECONDS,
      ArrowUp: el.currentTime + SEEK_STEP_SECONDS,
      Home: 0,
      End: total,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    seekTo(Math.min(total, Math.max(0, moves[e.key])) / total);
  }

  function onLoadedMetadata() {
    const el = audioRef.current;
    if (!el) return;
    if (el.duration === Infinity) {
      // Some recorded formats report no duration until the end is read;
      // jumping far ahead makes the browser look it up, then rewind.
      fixingDurationRef.current = true;
      el.currentTime = 1e7;
      return;
    }
    setDuration(el.duration);
  }

  function onDurationChange() {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    setDuration(el.duration);
    if (fixingDurationRef.current) {
      fixingDurationRef.current = false;
      el.currentTime = 0;
      setCurrent(0);
    }
  }

  if (failed) {
    return (
      <div
        className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-sm ${
          fromMe ? "bg-accent/15 text-foreground" : "bg-fill-strong text-muted"
        }`}
      >
        <MicIcon />
        <span>Voice message not available</span>
      </div>
    );
  }

  const shownSeconds = playing || current > 0 || scrub !== null
    ? (scrub !== null && known ? scrub * (duration as number) : current)
    : duration;
  const filled = fromMe ? "bg-white" : "bg-accent";
  const empty = fromMe ? "bg-white/40" : "bg-foreground/20";

  return (
    <div
      className={`flex w-[15.5rem] max-w-full items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-2 ${
        fromMe ? "bg-accent text-white" : "bg-fill-strong text-foreground"
      }`}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={onDurationChange}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        onTimeUpdate={() => {
          if (!playing && audioRef.current && !fixingDurationRef.current) {
            setCurrent(audioRef.current.currentTime);
          }
        }}
        onError={() => setFailed(true)}
      />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${PRESS} ${
          fromMe ? "bg-white text-accent" : "bg-accent text-white"
        }`}
      >
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} className="translate-x-px" />}
      </button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Voice message position"
        aria-valuemin={0}
        aria-valuemax={known ? Math.round(duration as number) : 0}
        aria-valuenow={Math.round(shownSeconds ?? 0)}
        aria-valuetext={`${formatDuration(shownSeconds ?? 0)} of ${known ? formatDuration(duration) : "unknown"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setScrub(null)}
        onKeyDown={onKeyDown}
        className={`relative flex h-8 min-w-0 flex-1 touch-none select-none items-center overflow-hidden ${
          known ? "cursor-pointer" : ""
        } rounded focus-visible:outline-offset-4`}
      >
        {/* Two identical bar rows; the bright one is clipped to the progress
            so the fill moves continuously, not bar by bar. */}
        <Bars bars={bars} className={empty} />
        <div
          className="absolute inset-0 flex items-center"
          style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
          aria-hidden="true"
        >
          <Bars bars={bars} className={filled} />
        </div>
      </div>

      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums tracking-[0.01em] opacity-90">
        {known || shownSeconds ? formatDuration(shownSeconds) : "-:--"}
      </span>

      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={`Playback speed ${SPEEDS[speedIndex]}x`}
        className={`h-6 min-w-9 shrink-0 rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${PRESS} ${
          fromMe ? "bg-white/20 hover:bg-white/30" : "bg-surface-hover hover:bg-border"
        }`}
      >
        {SPEEDS[speedIndex]}x
      </button>
    </div>
  );
}

function Bars({ bars, className }: { bars: number[]; className: string }) {
  return (
    <div className="flex h-5 w-full items-center justify-between gap-[2px] overflow-hidden" aria-hidden="true">
      {bars.map((height, i) => (
        <span
          key={i}
          // Bars shrink with the track so they never run under the duration.
          className={`w-[3px] min-w-px shrink rounded-full ${className}`}
          style={{ height: `${Math.round(height * 100)}%` }}
        />
      ))}
    </div>
  );
}
