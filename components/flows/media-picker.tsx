"use client";

/**
 * Picks the file for an image, video, audio, PDF or card image: from the
 * workspace library, a fresh upload, or an external https URL.
 */

import { useRef, useState } from "react";
import { MEDIA_UPLOAD_RULES, type MediaAssetKind } from "@/lib/flows/validate";
import type { MediaItem } from "./api-types";
import { useFlowEditor } from "./editor-context";
import { Icon } from "./icons";
import { Button, Collapse, TextField } from "./ui";

const KIND_NOUN: Record<MediaAssetKind, string> = {
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  FILE: "PDF",
};

const KIND_ARTICLE: Record<MediaAssetKind, string> = {
  IMAGE: "an image",
  VIDEO: "a video",
  AUDIO: "an audio file",
  FILE: "a PDF",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetThumb({ asset, className = "h-12 w-12" }: { asset: MediaItem; className?: string }) {
  if (asset.kind === "IMAGE") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={asset.path} alt="" className={`${className} shrink-0 rounded-md border border-border object-cover`} />
    );
  }
  const glyph =
    asset.kind === "VIDEO" ? <Icon.video /> : asset.kind === "AUDIO" ? <Icon.audio /> : <Icon.file />;
  return (
    <span className={`${className} grid shrink-0 place-items-center rounded-md border border-border bg-surface-hover text-muted`}>
      {glyph}
    </span>
  );
}

export function MediaPicker({
  kind,
  mediaId,
  url,
  onChange,
  compact = false,
}: {
  kind: MediaAssetKind;
  mediaId?: string;
  url?: string;
  onChange: (value: { mediaId?: string; url?: string }) => void;
  compact?: boolean;
}) {
  const { media, mediaById, uploadMedia } = useFlowEditor();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"none" | "library" | "url">(url ? "url" : "none");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rule = MEDIA_UPLOAD_RULES[kind];
  const selected = mediaId ? mediaById.get(mediaId) : undefined;
  const library = media.filter((item) => item.kind === kind);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > rule.maxBytes) {
      setError(`That file is too large. ${rule.label}.`);
      return;
    }
    setUploading(true);
    try {
      const asset = await uploadMedia(file);
      if (asset.kind !== kind) {
        setError(`This block needs ${KIND_ARTICLE[kind]}. The file was added to your library anyway.`);
        return;
      }
      onChange({ mediaId: asset.id });
      setMode("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      className="sr-only"
      tabIndex={-1}
      accept={[...rule.mimeTypes, ...rule.extensions.map((ext) => `.${ext}`)].join(",")}
      onChange={(e) => void handleFile(e.target.files?.[0])}
    />
  );

  if (mediaId) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border p-2">
        {selected ? <AssetThumb asset={selected} className={compact ? "h-10 w-10" : "h-12 w-12"} /> : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{selected?.filename ?? "File not found"}</p>
          <p className="text-xs text-muted">
            {selected ? formatBytes(selected.size) : "It may have been deleted. Choose another file."}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange({})}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {fileInput}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <Icon.upload className="h-3.5 w-3.5" />
          {uploading ? "Uploading…" : `Upload ${KIND_NOUN[kind]}`}
        </Button>
        <Button
          size="sm"
          variant={mode === "library" ? "primary" : "secondary"}
          onClick={() => setMode(mode === "library" ? "none" : "library")}
          aria-expanded={mode === "library"}
        >
          Library ({library.length})
        </Button>
        <Button
          size="sm"
          variant={mode === "url" ? "primary" : "ghost"}
          onClick={() => setMode(mode === "url" ? "none" : "url")}
          aria-expanded={mode === "url"}
        >
          <Icon.link className="h-3.5 w-3.5" />
          URL
        </Button>
      </div>
      {!compact && <p className="text-xs text-faint">{rule.label}</p>}
      {error && <p className="text-xs text-error">{error}</p>}

      <Collapse open={mode === "library"}>
        <div className="pt-1">
          {library.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
              No {KIND_NOUN[kind]} uploads yet.
            </p>
          ) : (
            <ul className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {library.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ mediaId: asset.id });
                      setMode("none");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border p-1.5 text-left hover:border-border-hover hover:bg-surface-hover active:scale-[0.98] transition-[background-color,border-color,scale] duration-150"
                  >
                    <AssetThumb asset={asset} className="h-10 w-10" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-foreground">{asset.filename}</span>
                      <span className="block text-[11px] text-faint">{formatBytes(asset.size)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Collapse>

      <Collapse open={mode === "url"}>
        <div className="pt-1">
          <TextField
            label={`${KIND_NOUN[kind]} URL`}
            value={url ?? ""}
            inputMode="url"
            placeholder="https://"
            onChange={(next) => onChange(next ? { url: next } : {})}
          />
        </div>
      </Collapse>
    </div>
  );
}
