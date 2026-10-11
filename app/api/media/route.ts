import { randomBytes } from "crypto";
import { unlink } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { mediaRuleFor, MEDIA_UPLOAD_RULES, type MediaAssetKind } from "@/lib/flows/validate";
import {
  MAX_MEDIA_BYTES,
  publicAssetUrl,
  resolveMediaKey,
  safeFilename,
  saveMedia,
} from "@/lib/media/storage";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 200;
/** Multipart framing on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const KINDS = Object.keys(MEDIA_UPLOAD_RULES) as MediaAssetKind[];

function jsonError(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * The id is the only capability guarding the public file URL, so it gets
 * 128 random bits instead of a cuid's timestamp and counter. Shaped like
 * a cuid (c + 25 base36 chars) so it fits everything that expects one.
 */
function generateAssetId(): string {
  const value = BigInt(`0x${randomBytes(16).toString("hex")}`);
  return `c${value.toString(36).padStart(25, "0")}`;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, i) => bytes[offset + i] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** True when the file's first bytes match its declared type. */
function contentMatches(mimeType: string, bytes: Uint8Array): boolean {
  switch (mimeType) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "application/pdf":
      return ascii(bytes, 0, Math.min(bytes.length, 1024)).includes("%PDF-");
    case "video/mp4":
    case "video/quicktime":
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return ["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(ascii(bytes, 4, 4));
    case "video/webm":
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case "video/ogg":
      return ascii(bytes, 0, 4) === "OggS";
    case "video/avi":
    case "video/x-msvideo":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "AVI ";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
    case "audio/mpeg":
      return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case "audio/aac":
      return (
        ascii(bytes, 0, 3) === "ID3" ||
        ascii(bytes, 0, 4) === "ADIF" ||
        (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0)
      );
    default:
      return false;
  }
}

function serializeAsset(asset: {
  id: string;
  kind: MediaAssetKind;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}) {
  return {
    id: asset.id,
    kind: asset.kind,
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: asset.size,
    createdAt: asset.createdAt,
    /** Absolute URL Meta fetches. */
    url: publicAssetUrl(asset),
    /** Same file on this origin, for previews in the app. */
    path: `/api/media/${asset.id}/${encodeURIComponent(asset.filename)}`,
  };
}

/** GET /api/media?kind=IMAGE : the workspace's uploads, newest first. */
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return jsonError(401, "Unauthorized");

  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind = kindParam && KINDS.includes(kindParam as MediaAssetKind) ? (kindParam as MediaAssetKind) : null;

  const assets = await prisma.mediaAsset.findMany({
    where: { workspaceId: context.workspaceId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });

  return NextResponse.json(
    { success: true, data: assets.map(serializeAsset) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** POST /api/media (multipart, field `file`) : stores one image, video, audio or PDF. */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return jsonError(401, "Unauthorized");
  if (!canManageWorkspace(context.role)) {
    return jsonError(403, "Only owners and admins can upload files");
  }
  const { workspaceId } = context;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_MEDIA_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return jsonError(413, "Files can be at most 25 MB");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Send the file as multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "Attach the file in the \"file\" field");

  const rule = mediaRuleFor(file.type, file.name);
  if (!rule) {
    return jsonError(
      415,
      "Instagram cannot send this file type. Use PNG or JPEG images, MP4, MOV, WebM, OGG or AVI videos, AAC, M4A, WAV or MP3 audio, or a PDF."
    );
  }
  if (file.size === 0) return jsonError(400, "The file is empty");
  if (file.size > rule.maxBytes) {
    return jsonError(413, `This file is too large. ${MEDIA_UPLOAD_RULES[rule.kind].label}.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!contentMatches(rule.mimeType, bytes)) {
    return jsonError(415, "The file content does not match its type. Export it again and retry.");
  }

  const id = generateAssetId();
  const filename = safeFilename(file.name);
  const storageKey = `assets/${safeFilename(workspaceId)}/${id}-${filename}`;

  try {
    await saveMedia(storageKey, bytes);
  } catch (error) {
    console.error("[media] save failed", { workspaceId, error });
    return jsonError(500, "Could not store the file");
  }

  try {
    const asset = await prisma.mediaAsset.create({
      data: {
        id,
        workspaceId,
        kind: rule.kind,
        filename,
        mimeType: rule.mimeType,
        size: bytes.byteLength,
        storageKey,
      },
    });
    return NextResponse.json({ success: true, data: serializeAsset(asset) }, { status: 201 });
  } catch (error) {
    console.error("[media] record failed", { workspaceId, error });
    await unlink(resolveMediaKey(storageKey)).catch(() => undefined);
    return jsonError(500, "Could not store the file");
  }
}
