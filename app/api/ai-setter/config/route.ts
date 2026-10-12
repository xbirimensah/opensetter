import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { z } from "zod";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { prisma } from "@/lib/db/client";
import { getKnowledgeBackend } from "@/lib/ai-setter/knowledge";
import { MAX_VOICE_RULES_CHARS, SETTER_STYLE_GUIDE } from "@/lib/ai-setter/prompt";
import { isProviderId, isSelectableProvider, PROVIDER_CATALOG } from "@/lib/ai-setter/providers/catalog";
import {
  discoverCliProviders,
  isCliProviderId,
  isValidCliModelId,
} from "@/lib/ai-setter/providers/cli";

const configSchema = z.object({
  instagramAccountId: z.string().optional().nullable(),
  mode: z.enum(["OFF", "DRAFT", "AUTO"]),
  persona: z.string().max(4000).optional().nullable(),
  goal: z.string().max(2000).optional().nullable(),
  // Sent to prospects verbatim: https links only (no javascript:, data:, http:).
  bookingLink: z
    .string()
    .max(500)
    .refine((value) => value.trim() === "" || /^https:\/\/[^\s]+$/i.test(value.trim()), "Use an https:// link")
    .optional()
    .nullable(),
  language: z.string().max(40).optional().nullable(),
  knowledgeEnabled: z.boolean(),
  styleExamplesEnabled: z.boolean(),
  minConfidence: z.number().min(0).max(1),
  replyDelaySeconds: z.number().int().min(0).max(600),
  pauseOnHumanReply: z.boolean(),
  windowNudgeEnabled: z.boolean(),
  windowNudgeHours: z.number().int().min(1).max(23),
  blockedUserIds: z.array(z.string().max(64)).max(500),
  // Sprachprofil and model selection. Optional so older clients that do
  // not send them leave the stored values alone.
  voiceRules: z.string().max(MAX_VOICE_RULES_CHARS).optional().nullable(),
  styleCorpusEnabled: z.boolean().optional(),
  strictVoiceEvidence: z.boolean().optional(),
  llmProvider: z
    .string()
    .refine(isSelectableProvider, "Unknown provider")
    .optional()
    .nullable(),
  llmModel: z.string().max(200).optional().nullable(),
});

const DEFAULT_CONFIG = {
  mode: "OFF",
  persona: null,
  goal: null,
  bookingLink: null,
  language: null,
  knowledgeEnabled: true,
  styleExamplesEnabled: true,
  minConfidence: 0.78,
  replyDelaySeconds: 10,
  pauseOnHumanReply: true,
  windowNudgeEnabled: false,
  windowNudgeHours: 20,
  blockedUserIds: [] as string[],
  voiceRules: null,
  styleCorpusEnabled: true,
  strictVoiceEvidence: false,
  styleCorpusBuiltAt: null,
  llmProvider: null,
  llmModel: null,
};

type ConfigPayload = z.infer<typeof configSchema>;

/**
 * Settings that decide whether, when and to whom the setter sends DMs
 * unattended. Only owners and admins may change them; members can still
 * edit persona, goal, voice and knowledge settings.
 */
const OPERATIONAL_FIELDS = [
  "mode",
  "minConfidence",
  "replyDelaySeconds",
  "pauseOnHumanReply",
  "windowNudgeEnabled",
  "windowNudgeHours",
  "blockedUserIds",
  "strictVoiceEvidence",
  // What the unattended setter says to prospects is a manager decision too.
  "persona",
  "goal",
  "bookingLink",
  "voiceRules",
  "knowledgeEnabled",
] as const;

type OperationalField = (typeof OPERATIONAL_FIELDS)[number];

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const left = [...new Set(a)].sort();
    const right = [...new Set(b)].sort();
    return left.length === right.length && left.every((value, i) => value === right[i]);
  }
  return a === b;
}

/** Operational fields the payload would change (omitted optional fields never count). */
function changedOperationalFields(
  current: Record<OperationalField, unknown>,
  next: Pick<ConfigPayload, OperationalField>
): OperationalField[] {
  return OPERATIONAL_FIELDS.filter(
    (field) => next[field] !== undefined && !sameValue(current[field], next[field])
  );
}

/**
 * A CLI selection must name a CLI that is enabled and installed here and,
 * if a model is given, an id that cannot turn into a CLI flag. Sign-in is
 * not required to save (it can be fixed on the server afterwards); the
 * Models tab shows it.
 */
async function checkCliSelection(
  provider: "claude-cli" | "codex-cli",
  model: string | null
): Promise<string | null> {
  if (model && !isValidCliModelId(model)) {
    return "Model id may only contain letters, digits and . _ : / @ [ ] - and must start with a letter or digit.";
  }
  const status = (await discoverCliProviders()).find((cli) => cli.provider === provider);
  if (!status?.selectable) return status?.problem ?? "This CLI is not available on the server.";
  return null;
}

// Read the setter config for one connected account (defaults when unset).
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    context.workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  const config = await prisma.aiSetterConfig.findUnique({
    where: { instagramAccountId: account.id },
  });

  return NextResponse.json({
    success: true,
    data: {
      account: {
        id: account.id,
        username: account.username,
        instagramId: account.instagramId,
      },
      knowledgeConfigured: getKnowledgeBackend() !== null,
      defaultVoiceRules: SETTER_STYLE_GUIDE,
      knowledgeBackend: getKnowledgeBackend(),
      config: config ?? DEFAULT_CONFIG,
    },
  });
}

// Create or update the setter config for one connected account.
export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let parsed: ConfigPayload;
  try {
    parsed = configSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid config payload" },
      { status: 400 }
    );
  }

  const { workspaceId } = context;
  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    parsed.instagramAccountId ?? null
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  const llmProvider =
    parsed.llmProvider === undefined ? undefined : parsed.llmProvider || null;
  const llmModel = llmProvider ? parsed.llmModel?.trim() || null : null;

  // Members may not change anything that controls unattended sending
  // (mode, threshold, delay, takeover pause, nudges, block list, voice
  // gate) or the provider, which spends the workspace's saved keys.
  // Fails closed: with no stored config the defaults are the baseline.
  if (!canManageWorkspace(context.role)) {
    const current = await prisma.aiSetterConfig.findUnique({
      where: { instagramAccountId: account.id },
      select: {
        mode: true,
        minConfidence: true,
        replyDelaySeconds: true,
        pauseOnHumanReply: true,
        windowNudgeEnabled: true,
        windowNudgeHours: true,
        blockedUserIds: true,
        strictVoiceEvidence: true,
        persona: true,
        goal: true,
        bookingLink: true,
        voiceRules: true,
        knowledgeEnabled: true,
        llmProvider: true,
        llmModel: true,
      },
    });
    const baseline = current ?? DEFAULT_CONFIG;
    const providerChanged =
      llmProvider !== undefined &&
      ((baseline.llmProvider ?? null) !== llmProvider ||
        (baseline.llmModel ?? null) !== llmModel);
    if (providerChanged) {
      return NextResponse.json(
        { success: false, error: "Only workspace owners and admins can change the model provider." },
        { status: 403 }
      );
    }
    const changed = changedOperationalFields(baseline, parsed);
    if (changed.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Only workspace owners and admins can change sending settings (${changed.join(", ")}).`,
        },
        { status: 403 }
      );
    }
  }

  if (llmProvider && isCliProviderId(llmProvider)) {
    const problem = await checkCliSelection(llmProvider, llmModel);
    if (problem) {
      return NextResponse.json({ success: false, error: problem }, { status: 400 });
    }
  } else if (llmProvider) {
    const credential = await prisma.aiProviderCredential.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: llmProvider } },
      select: { id: true },
    });
    if (!credential) {
      const label = isProviderId(llmProvider) ? PROVIDER_CATALOG[llmProvider].label : llmProvider;
      return NextResponse.json(
        { success: false, error: `Save an API key for ${label} before selecting it.` },
        { status: 400 }
      );
    }
  }

  // Unchanged rules are stored as null so future default improvements
  // still reach owners who never edited them.
  const voiceRules =
    parsed.voiceRules === undefined
      ? undefined
      : parsed.voiceRules?.trim() && parsed.voiceRules.trim() !== SETTER_STYLE_GUIDE
        ? parsed.voiceRules.trim()
        : null;

  const values = {
    mode: parsed.mode,
    persona: parsed.persona?.trim() || null,
    goal: parsed.goal?.trim() || null,
    bookingLink: parsed.bookingLink?.trim() || null,
    language: parsed.language?.trim() || null,
    knowledgeEnabled: parsed.knowledgeEnabled,
    styleExamplesEnabled: parsed.styleExamplesEnabled,
    minConfidence: parsed.minConfidence,
    replyDelaySeconds: parsed.replyDelaySeconds,
    pauseOnHumanReply: parsed.pauseOnHumanReply,
    windowNudgeEnabled: parsed.windowNudgeEnabled,
    windowNudgeHours: parsed.windowNudgeHours,
    blockedUserIds: parsed.blockedUserIds,
    ...(voiceRules !== undefined ? { voiceRules } : {}),
    ...(parsed.styleCorpusEnabled !== undefined
      ? { styleCorpusEnabled: parsed.styleCorpusEnabled }
      : {}),
    ...(parsed.strictVoiceEvidence !== undefined
      ? { strictVoiceEvidence: parsed.strictVoiceEvidence }
      : {}),
    ...(llmProvider !== undefined ? { llmProvider, llmModel } : {}),
  };

  const previousMode =
    (
      await prisma.aiSetterConfig.findUnique({
        where: { instagramAccountId: account.id },
        select: { mode: true },
      })
    )?.mode ?? DEFAULT_CONFIG.mode;

  const config = await prisma.aiSetterConfig.upsert({
    where: { instagramAccountId: account.id },
    create: { instagramAccountId: account.id, ...values },
    update: values,
  });
  if (previousMode !== parsed.mode) {
    await audit({
      action: "ai.setter_mode_changed",
      workspaceId,
      actorUserId: context.userId,
      detail: { instagramAccountId: account.id, from: previousMode, to: parsed.mode },
    });
  }

  return NextResponse.json({ success: true, data: { config } });
}
