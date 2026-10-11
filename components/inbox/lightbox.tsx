"use client";

/**
 * Full-screen photo viewer on a native modal <dialog>: focus is trapped,
 * Escape and a tap outside the photo close it, and the page behind is
 * inert while it is open.
 */

import { useEffect, useRef } from "react";
import { CloseIcon, ExternalIcon } from "@/components/inbox/icons";
import { PRESS } from "@/components/inbox/ui";
import styles from "@/components/inbox/inbox.module.css";

export interface LightboxImage {
  src: string;
  alt: string;
}

/**
 * `image` stays set after closing so the photo is still there while the
 * dialog fades out; `open` drives visibility.
 */
export default function Lightbox({
  image,
  open,
  onClose,
}: {
  image: LightboxImage | null;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && image && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open, image]);

  return (
    <dialog
      ref={ref}
      className={styles.lightbox}
      aria-label={image?.alt ?? "Photo"}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {image && (
        <div
          className="flex h-full w-full flex-col"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="flex shrink-0 items-center justify-end gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <a
              href={image.src}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/20 ${PRESS}`}
            >
              <ExternalIcon />
              Open original
            </a>
            <button
              type="button"
              onClick={onClose}
              autoFocus
              aria-label="Close photo"
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 ${PRESS}`}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated media route, not optimizable */}
            <img
              src={image.src}
              alt={image.alt}
              className={`max-h-full max-w-full rounded-lg object-contain ${styles.lightboxImage}`}
            />
          </div>
        </div>
      )}
    </dialog>
  );
}
