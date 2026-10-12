"use client";

/**
 * Message step: ordered content blocks (text with buttons, image, video,
 * audio, PDF, card gallery, typing pause), quick replies and routing.
 */

import { LIMITS, type FlowCard, type FlowContent, type MessageNode } from "@/lib/flows/types";
import { FLOW_EDITOR_LIMITS, MEDIA_KIND_FOR_CONTENT, textUsage } from "@/lib/flows/validate";
import { ButtonList } from "./button-list";
import { useFlowEditor } from "./editor-context";
import { createCard, createContent, moveItem, newId } from "./graph-utils";
import { ContentTypeIcon, Icon } from "./icons";
import { MediaPicker } from "./media-picker";
import { StepSelect } from "./step-select";
import { Counter, IconButton, Menu, NumberField, TextField } from "./ui";

const BLOCK_TYPES: { type: FlowContent["type"]; label: string; hint: string }[] = [
  { type: "text", label: "Text", hint: "Up to 3 buttons" },
  { type: "image", label: "Image", hint: "PNG or JPEG, 8 MB" },
  { type: "video", label: "Video", hint: "Up to 25 MB" },
  { type: "audio", label: "Audio", hint: "Sent as a voice message" },
  { type: "file", label: "PDF file", hint: "Up to 25 MB" },
  { type: "cards", label: "Cards gallery", hint: "Up to 10 swipeable cards" },
  { type: "typing", label: "Typing pause", hint: "Wait before the next block" },
];

const BLOCK_LABELS = Object.fromEntries(BLOCK_TYPES.map((b) => [b.type, b.label])) as Record<FlowContent["type"], string>;

function hasRoutingTaps(node: MessageNode): boolean {
  if ((node.quickReplies?.length ?? 0) > 0) return true;
  return node.contents.some((content) => {
    const buttons =
      content.type === "text" ? content.buttons ?? [] : content.type === "cards" ? content.cards.flatMap((c) => c.buttons) : [];
    return buttons.some((b) => b.type !== "url");
  });
}

export const MESSAGE_BLOCK_TYPES = BLOCK_TYPES;

export function MessageEditor({
  node,
  onChange,
  palette,
}: {
  node: MessageNode;
  onChange: (node: MessageNode) => void;
  /** Replaces the "Add block" menu (the canvas sidebar shows a block palette). */
  palette?: (add: (type: FlowContent["type"]) => void, full: boolean) => React.ReactNode;
}) {
  const contents = node.contents;
  const setContents = (next: FlowContent[]) => onChange({ ...node, contents: next });
  const updateBlock = (index: number, block: FlowContent) => setContents(contents.map((c, i) => (i === index ? block : c)));
  const waits = hasRoutingTaps(node);

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {contents.map((block, index) => (
          <li key={block.id} className="rounded-xl border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <ContentTypeIcon type={block.type} className="h-3.5 w-3.5 text-muted" />
              <span className="flex-1 text-xs font-medium text-muted">{BLOCK_LABELS[block.type]}</span>
              <IconButton label="Move block up" disabled={index === 0} onClick={() => setContents(moveItem(contents, index, -1))}>
                <Icon.up className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Move block down"
                disabled={index === contents.length - 1}
                onClick={() => setContents(moveItem(contents, index, 1))}
              >
                <Icon.down className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Delete block" tone="danger" onClick={() => setContents(contents.filter((_, i) => i !== index))}>
                <Icon.trash className="h-3.5 w-3.5" />
              </IconButton>
            </div>
            <div className="p-3">
              <BlockEditor block={block} ownerId={node.id} onChange={(next) => updateBlock(index, next)} />
            </div>
          </li>
        ))}
      </ol>

      {!palette && contents.length < FLOW_EDITOR_LIMITS.contentsPerMessageMax && (
        <Menu
          width="w-64"
          items={BLOCK_TYPES.map((b) => ({
            label: b.label,
            hint: b.hint,
            icon: <ContentTypeIcon type={b.type} className="h-4 w-4" />,
            onSelect: () => setContents([...contents, createContent(b.type)]),
          }))}
          trigger={(props) => (
            <button
              type="button"
              {...props}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm text-muted transition-colors hover:border-border-hover hover:text-foreground active:scale-[0.99] sm:min-h-10"
            >
              <Icon.plus className="h-4 w-4" />
              Add block
            </button>
          )}
        />
      )}

      <QuickReplies node={node} onChange={onChange} />

      {palette?.(
        (type) => setContents([...contents, createContent(type)]),
        contents.length >= FLOW_EDITOR_LIMITS.contentsPerMessageMax
      )}

      <div className="space-y-1.5 border-t border-border pt-4">
        <StepSelect
          label="Choose Next Step"
          endLabel={waits ? "Wait for a tap" : "End flow"}
          value={node.next}
          ownerId={node.id}
          onChange={(next) => onChange({ ...node, next })}
        />
        <p className="text-xs text-muted">
          {node.next
            ? "Continues right away. Buttons and quick replies still route their taps."
            : waits
              ? "Waits until they tap a button or a quick reply."
              : "The flow ends after this message."}
        </p>
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  ownerId,
  onChange,
}: {
  block: FlowContent;
  ownerId: string;
  onChange: (block: FlowContent) => void;
}) {
  const { variables } = useFlowEditor();

  switch (block.type) {
    case "text": {
      const buttons = block.buttons ?? [];
      const usage = textUsage(block.text, buttons.length > 0);
      return (
        <div className="space-y-3">
          <TextField
            multiline
            rows={4}
            value={block.text}
            max={usage.max}
            variables={variables}
            placeholder="Write your message"
            onChange={(text) => onChange({ ...block, text })}
          />
          <ButtonList
            buttons={buttons}
            ownerId={ownerId}
            onChange={(next) => onChange({ ...block, buttons: next.length > 0 ? next : undefined })}
          />
        </div>
      );
    }
    case "image":
    case "video":
    case "audio":
    case "file":
      return (
        <MediaPicker
          kind={MEDIA_KIND_FOR_CONTENT[block.type]}
          mediaId={block.mediaId}
          url={block.url}
          onChange={(value) => onChange({ id: block.id, type: block.type, ...value })}
        />
      );
    case "cards":
      return <CardsEditor cards={block.cards} ownerId={ownerId} onChange={(cards) => onChange({ ...block, cards })} />;
    case "typing":
      return (
        <div className="space-y-1.5">
          <NumberField
            label="Pause"
            value={block.seconds}
            min={1}
            max={LIMITS.typingMaxSeconds}
            suffix="seconds"
            onChange={(seconds) => onChange({ ...block, seconds })}
          />
          <p className="text-xs text-muted">Shows the typing indicator, then sends the next block. Up to {LIMITS.typingMaxSeconds} seconds.</p>
        </div>
      );
  }
}

function CardsEditor({
  cards,
  ownerId,
  onChange,
}: {
  cards: FlowCard[];
  ownerId: string;
  onChange: (cards: FlowCard[]) => void;
}) {
  const update = (index: number, card: FlowCard) => onChange(cards.map((c, i) => (i === index ? card : c)));

  return (
    <div className="space-y-3">
      {cards.map((card, index) => (
        <div key={card.id} className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">
              Card {index + 1} of {cards.length}
            </span>
            <div className="flex items-center">
              <IconButton label="Move card up" disabled={index === 0} onClick={() => onChange(moveItem(cards, index, -1))}>
                <Icon.up className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Move card down" disabled={index === cards.length - 1} onClick={() => onChange(moveItem(cards, index, 1))}>
                <Icon.down className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Duplicate card"
                disabled={cards.length >= LIMITS.cardsMax}
                onClick={() =>
                  onChange([
                    ...cards.slice(0, index + 1),
                    { ...card, id: newId("k"), buttons: card.buttons.map((b) => ({ ...b, id: newId("b") })) },
                    ...cards.slice(index + 1),
                  ])
                }
              >
                <Icon.copy className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Delete card" tone="danger" onClick={() => onChange(cards.filter((_, i) => i !== index))}>
                <Icon.trash className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
          <MediaPicker
            compact
            kind="IMAGE"
            mediaId={card.imageMediaId}
            url={card.imageUrl}
            onChange={(value) => update(index, { ...card, imageMediaId: value.mediaId, imageUrl: value.url })}
          />
          <TextField
            label="Title"
            value={card.title}
            max={LIMITS.cardTitleMax}
            placeholder="Free guide"
            onChange={(title) => update(index, { ...card, title })}
          />
          <TextField
            label="Subtitle"
            value={card.subtitle ?? ""}
            max={LIMITS.cardSubtitleMax}
            placeholder="Optional"
            onChange={(subtitle) => update(index, { ...card, subtitle })}
          />
          <ButtonList buttons={card.buttons} ownerId={ownerId} onChange={(buttons) => update(index, { ...card, buttons })} />
        </div>
      ))}
      {cards.length < LIMITS.cardsMax && (
        <button
          type="button"
          onClick={() => onChange([...cards, createCard()])}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10 sm:min-h-8"
        >
          <Icon.plus className="h-3.5 w-3.5" />
          Add card ({cards.length}/{LIMITS.cardsMax})
        </button>
      )}
    </div>
  );
}

function QuickReplies({ node, onChange }: { node: MessageNode; onChange: (node: MessageNode) => void }) {
  const replies = node.quickReplies ?? [];
  const set = (next: MessageNode["quickReplies"]) => onChange({ ...node, quickReplies: next && next.length > 0 ? next : undefined });

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Quick replies</p>
        {replies.length > 0 && <Counter used={replies.length} max={LIMITS.quickRepliesMax} />}
      </div>
      {replies.length === 0 && (
        <p className="text-xs text-muted">Tappable chips under the last block. They disappear after one tap.</p>
      )}
      {replies.map((reply, index) => (
        <div key={reply.id} className="grid gap-2 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <TextField
            label={`Reply ${index + 1}`}
            value={reply.title}
            max={LIMITS.quickReplyTitleMax}
            placeholder="Tell me more"
            onChange={(title) => set(replies.map((r, i) => (i === index ? { ...r, title } : r)))}
          />
          <StepSelect
            label="When tapped"
            value={reply.next}
            ownerId={node.id}
            onChange={(next) => set(replies.map((r, i) => (i === index ? { ...r, next } : r)))}
          />
          <IconButton label="Delete quick reply" tone="danger" onClick={() => set(replies.filter((_, i) => i !== index))}>
            <Icon.trash className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ))}
      {replies.length < LIMITS.quickRepliesMax && (
        <button
          type="button"
          onClick={() => set([...replies, { id: newId("q"), title: "", next: null }])}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent hover:bg-accent/10 sm:min-h-8"
        >
          <Icon.plus className="h-3.5 w-3.5" />
          Add quick reply
        </button>
      )}
    </div>
  );
}
