/**
 * Flow executor: walks a flow graph for one contact.
 *
 * All side effects go through EngineIO (sending, contact writes, analytics,
 * scheduling), so this file holds the behaviour and nothing else. The
 * Prisma/Meta implementation lives in service.ts; tests use a fake IO.
 *
 * Rules taken from Instagram + ManyChat behaviour:
 * - A comment-started run gets ONE private reply. Everything after it waits
 *   until the contact replies or taps a postback/quick reply.
 * - Every other send needs the 24h window (last inbound message or tap).
 *   A closed window expires the run; delays never reopen it.
 * - Buttons route on their own; a message with buttons and no "next" waits.
 */

import type { BuiltMessage } from "./message-builder";
import { buildContentMessage } from "./message-builder";
import { DEFAULT_RETRY_MESSAGES, checkInput } from "./input-validation";
import { contactPayload, renderTemplate, type FlowContact, type VariableScope } from "./variables";
import {
  LIMITS,
  decodeFlowPayload,
  type FlowAction,
  type FlowButton,
  type FlowGraph,
  type FlowNode,
  type FlowQuickReply,
  type FlowRule,
  type FlowRunContext,
  type FlowWaiting,
  type InputNode,
  type MessageNode,
} from "./types";

export type RunStatus = "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED";

export type EventType =
  | "STARTED"
  | "SENT"
  | "SEND_FAILED"
  | "CLICKED"
  | "REPLIED"
  | "INPUT_VALID"
  | "INPUT_INVALID"
  | "CONDITION_TRUE"
  | "CONDITION_FALSE"
  | "ACTION"
  | "COMPLETED"
  | "EXPIRED"
  | "CANCELLED";

export interface RunState {
  id: string;
  flowId: string;
  status: RunStatus;
  currentNodeId: string | null;
  waiting: FlowWaiting | null;
  retries: number;
  context: FlowRunContext;
  sends: number;
  lastError: string | null;
  completedAt: Date | null;
}

export interface ContactPatch {
  email?: string;
  emailCapturedAt?: Date;
  phone?: string;
  phoneCapturedAt?: Date;
  tags?: string[];
  customFields?: Record<string, string | number | boolean>;
}

export type WebhookAction = Extract<FlowAction, { type: "webhook" }>;

export interface EngineIO {
  now(): Date;
  random(): number;
  sleep(ms: number): Promise<void>;
  /** viaComment: send as the private reply to this comment id. */
  send(message: BuiltMessage, opts: { viaComment: string | null; nodeId: string; prepaid: boolean }): Promise<void>;
  followsAccount(): Promise<boolean | null>;
  updateContact(patch: ContactPatch): Promise<void>;
  setAiEnabled(enabled: boolean): Promise<void>;
  request(action: WebhookAction, body: string | undefined): Promise<{ ok: boolean; status: number; json: unknown }>;
  notify(message: string): Promise<void>;
  record(type: EventType, nodeId: string, detail?: Record<string, unknown>): Promise<void>;
  scheduleResume(nodeId: string, delayMs: number): Promise<void>;
  startOtherFlow(flowId: string): Promise<void>;
  mediaUrl(mediaId: string): Promise<string | null>;
  linkUrl(nodeId: string, buttonId: string, url: string): Promise<string>;
  /**
   * Rewrite a comment run's first message template as a reply to the
   * comment; null keeps the template. Optional: tests and old callers
   * without an AI setter simply never personalize.
   */
  personalizeOpener?(template: string, commentText: string): Promise<string | null>;
}

export const SKIP_BUTTON_ID = "__skip__";

const WAIT = Symbol("wait");
const STOP = Symbol("stop");
type StepResult = string | null | typeof WAIT | typeof STOP;

function messageButtons(node: MessageNode): FlowButton[] {
  return node.contents.flatMap((c) =>
    c.type === "text" ? c.buttons ?? [] : c.type === "cards" ? c.cards.flatMap((card) => card.buttons) : []
  );
}

function getPath(value: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, value);
}

export class FlowExecutor {
  private state: RunState;
  private contact: FlowContact;
  private followsCache: boolean | null | undefined;
  private typedMs = 0;

  constructor(
    private readonly flow: { id: string; name: string; graph: FlowGraph },
    state: RunState,
    contact: FlowContact,
    private readonly io: EngineIO
  ) {
    this.state = { ...state, context: { ...state.context } };
    this.contact = { ...contact, tags: [...contact.tags], customFields: { ...contact.customFields } };
  }

  getState(): RunState {
    return this.state;
  }

  getContact(): FlowContact {
    return this.contact;
  }

  private node(id: string | null | undefined): FlowNode | undefined {
    return id ? this.flow.graph.nodes.find((n) => n.id === id) : undefined;
  }

  private scope(): VariableScope {
    const ctx = this.state.context;
    return { contact: this.contact, commentText: ctx.commentText, keyword: ctx.keyword, ref: ctx.ref };
  }

  private render = (text: string) => renderTemplate(text, this.scope());

  private resolvers(nodeId: string) {
    return {
      flowId: this.flow.id,
      nodeId,
      mediaUrl: (id: string) => this.io.mediaUrl(id),
      linkUrl: (buttonId: string, url: string) => this.io.linkUrl(nodeId, buttonId, url),
      render: this.render,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async start(startNodeId?: string | null): Promise<void> {
    await this.io.record("STARTED", startNodeId ?? this.flow.graph.startNodeId ?? "start", {
      trigger: this.state.context.trigger,
    });
    await this.run(startNodeId ?? this.flow.graph.startNodeId);
  }

  private setWaiting(waiting: FlowWaiting): typeof WAIT {
    this.state = { ...this.state, status: "WAITING", waiting, currentNodeId: waiting.nodeId };
    return WAIT;
  }

  private async complete(nodeId?: string | null): Promise<typeof STOP> {
    this.state = {
      ...this.state,
      status: "COMPLETED",
      waiting: null,
      completedAt: this.io.now(),
    };
    await this.io.record("COMPLETED", nodeId ?? this.state.currentNodeId ?? "end");
    return STOP;
  }

  private async expire(reason: string): Promise<typeof STOP> {
    this.state = {
      ...this.state,
      status: "EXPIRED",
      waiting: null,
      lastError: reason,
      completedAt: this.io.now(),
    };
    await this.io.record("EXPIRED", this.state.currentNodeId ?? "end", { reason });
    return STOP;
  }

  private fail(reason: string): typeof STOP {
    this.state = {
      ...this.state,
      status: "FAILED",
      waiting: null,
      lastError: reason.slice(0, 500),
      completedAt: this.io.now(),
    };
    return STOP;
  }

  /** Execute from a node until the flow waits, ends or fails. */
  async run(fromNodeId: string | null | undefined, contentIndex = 0): Promise<void> {
    this.state = { ...this.state, status: "RUNNING", waiting: null };
    let current: string | null | undefined = fromNodeId;
    let startIndex = contentIndex;
    let steps = 0;

    while (current) {
      steps += 1;
      if (steps > LIMITS.maxStepsPerPass) {
        this.fail("Stopped: more than 40 steps in one pass (is there a loop?)");
        return;
      }
      const node = this.node(current);
      if (!node) break;
      this.state = { ...this.state, currentNodeId: node.id };
      const result: StepResult = await this.exec(node, startIndex);
      startIndex = 0;
      if (result === WAIT || result === STOP) return;
      current = result;
    }
    await this.complete();
  }

  // ── Window and sending ────────────────────────────────────────────────

  private sendGate(): "private_reply" | "interaction" | "open" | "closed" {
    const ctx = this.state.context;
    if (ctx.commentId && !ctx.interacted) {
      return this.state.sends === 0 ? "private_reply" : "interaction";
    }
    const last = this.contact.lastInboundAt;
    if (!last || this.io.now().getTime() - last.getTime() >= LIMITS.windowMs) return "closed";
    return "open";
  }

  /** Returns WAIT/STOP when the message cannot go out now, else null. */
  private async gateOrPark(nodeId: string, contentIndex: number): Promise<typeof WAIT | typeof STOP | "private_reply" | "open"> {
    const gate = this.sendGate();
    if (gate === "interaction") return this.setWaiting({ kind: "interaction", nodeId, contentIndex });
    if (gate === "closed") return this.expire("The 24h messaging window is closed");
    return gate;
  }

  private async sendBuilt(built: BuiltMessage, nodeId: string, gate: "private_reply" | "open", detail: Record<string, unknown>): Promise<boolean> {
    const ctx = this.state.context;
    const viaComment = gate === "private_reply" ? ctx.commentId ?? null : null;
    try {
      await this.io.send(built, {
        viaComment,
        nodeId,
        prepaid: Boolean(viaComment && this.state.sends === 0 && ctx.trigger === "comment"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";
      await this.io.record("SEND_FAILED", nodeId, { ...detail, error: message.slice(0, 300) });
      this.fail(`Send failed at ${nodeId}: ${message}`);
      return false;
    }
    this.state = { ...this.state, sends: this.state.sends + 1 };
    await this.io.record("SENT", nodeId, detail);
    return true;
  }

  // ── Node execution ────────────────────────────────────────────────────

  private async exec(node: FlowNode, contentIndex: number): Promise<StepResult> {
    switch (node.type) {
      case "message":
        return this.execMessage(node, contentIndex);
      case "input":
        return this.execInput(node);
      case "condition": {
        const results = await Promise.all(node.rules.map((rule) => this.evaluate(rule)));
        const passed = node.match === "any" ? results.some(Boolean) : results.every(Boolean);
        await this.io.record(passed ? "CONDITION_TRUE" : "CONDITION_FALSE", node.id);
        return passed ? node.next : node.elseNext;
      }
      case "action":
        for (const action of node.actions) await this.applyAction(node.id, action);
        return node.next ?? null;
      case "delay": {
        const ms = Math.max(1, Math.round(node.seconds)) * 1000;
        const resumeAt = new Date(this.io.now().getTime() + ms);
        await this.io.scheduleResume(node.id, ms);
        return this.setWaiting({ kind: "delay", nodeId: node.id, resumeAt: resumeAt.toISOString() });
      }
      case "randomizer": {
        const branches = node.branches.filter((b) => b.weight > 0);
        if (branches.length === 0) return null;
        const sticky = this.state.context.randomizer?.[node.id];
        const stuck = branches.find((b) => b.id === sticky);
        if (stuck) return stuck.next;
        const total = branches.reduce((sum, b) => sum + b.weight, 0);
        let roll = this.io.random() * total;
        const chosen = branches.find((b) => (roll -= b.weight) < 0) ?? branches[branches.length - 1];
        this.state = {
          ...this.state,
          context: {
            ...this.state.context,
            randomizer: { ...(this.state.context.randomizer ?? {}), [node.id]: chosen.id },
          },
        };
        return chosen.next;
      }
      case "start_flow":
        await this.io.startOtherFlow(node.flowId);
        return this.complete(node.id);
      case "ai_handoff":
        await this.io.setAiEnabled(true);
        return this.complete(node.id);
    }
  }

  private quickReplyIndex(node: MessageNode): number {
    if (!node.quickReplies?.length) return -1;
    for (let i = node.contents.length - 1; i >= 0; i--) {
      const c = node.contents[i];
      if (c.type === "text" && !(c.buttons?.length)) return i;
    }
    return -1;
  }

  private async execMessage(node: MessageNode, startIndex: number): Promise<StepResult> {
    const qrIndex = this.quickReplyIndex(node);
    const resolvers = this.resolvers(node.id);

    for (let i = startIndex; i < node.contents.length; i++) {
      const content = node.contents[i];
      if (content.type === "typing") {
        // The conversation lock is held while we sleep, so typing pauses are
        // capped per pass; the rest of the pause is simply skipped.
        const wanted = Math.min(Math.max(content.seconds, 0), LIMITS.typingMaxSeconds) * 1000;
        const ms = Math.max(0, Math.min(wanted, LIMITS.typingMaxSecondsPerPass * 1000 - this.typedMs));
        this.typedMs += ms;
        if (ms > 0) await this.io.sleep(ms);
        continue;
      }
      const gate = await this.gateOrPark(node.id, i);
      if (gate === WAIT || gate === STOP) return gate;
      const personalized = await this.personalizedContent(content, gate);
      let built: BuiltMessage | null;
      try {
        built = await buildContentMessage(personalized, resolvers, i === qrIndex ? node.quickReplies : undefined);
      } catch (error) {
        return this.fail(error instanceof Error ? error.message : "Could not build message");
      }
      if (!built) continue;
      const detail = personalized !== content ? { contentId: content.id, aiOpener: true } : { contentId: content.id };
      if (!(await this.sendBuilt(built, node.id, gate, detail))) return STOP;
    }

    // Quick replies need a plain text block; without one, carry them on a pointer line.
    if (node.quickReplies?.length && qrIndex === -1) {
      const gate = await this.gateOrPark(node.id, node.contents.length);
      if (gate === WAIT || gate === STOP) return gate;
      const built = await buildContentMessage({ id: `${node.id}-qr`, type: "text", text: "\u{1F447}" }, resolvers, node.quickReplies);
      if (built && !(await this.sendBuilt(built, node.id, gate, { contentId: `${node.id}-qr` }))) return STOP;
    }

    if (node.next) return node.next;
    // URL buttons open a link and never route, so only postback buttons and
    // quick replies keep the run waiting.
    const routes = messageButtons(node).some((b) => b.type !== "url");
    if (routes || node.quickReplies?.length) {
      return this.setWaiting({ kind: "buttons", nodeId: node.id });
    }
    return null;
  }

  /**
   * The first text of a comment run with the AI opener on, rewritten to
   * the comment. Any other content, or a failed rewrite, is unchanged.
   */
  private async personalizedContent<C extends MessageNode["contents"][number]>(content: C, gate: "private_reply" | "open"): Promise<C> {
    const ctx = this.state.context;
    if (
      content.type !== "text" ||
      gate !== "private_reply" ||
      this.state.sends !== 0 ||
      ctx.trigger !== "comment" ||
      !ctx.aiOpener ||
      !ctx.commentText ||
      !this.io.personalizeOpener ||
      !content.text.trim()
    ) {
      return content;
    }
    const rewritten = await this.io.personalizeOpener(content.text, ctx.commentText).catch(() => null);
    return rewritten ? { ...content, text: rewritten } : content;
  }

  private skipReply(node: InputNode): FlowQuickReply[] | undefined {
    return node.skipLabel ? [{ id: SKIP_BUTTON_ID, title: node.skipLabel, next: node.onFail ?? null }] : undefined;
  }

  private async sendInputText(node: InputNode, text: string): Promise<StepResult | "sent"> {
    const gate = await this.gateOrPark(node.id, 0);
    if (gate === WAIT || gate === STOP) return gate;
    const built = await buildContentMessage(
      { id: `${node.id}-prompt`, type: "text", text },
      this.resolvers(node.id),
      this.skipReply(node)
    );
    if (built && !(await this.sendBuilt(built, node.id, gate, { contentId: `${node.id}-prompt` }))) return STOP;
    return "sent";
  }

  private inputExpiry(node: InputNode): string {
    const now = this.io.now().getTime();
    const timeout = (node.timeoutMinutes ?? 1440) * 60 * 1000;
    const windowEnd = this.contact.lastInboundAt
      ? this.contact.lastInboundAt.getTime() + LIMITS.windowMs
      : now + timeout;
    return new Date(Math.min(now + timeout, windowEnd)).toISOString();
  }

  private async execInput(node: InputNode): Promise<StepResult> {
    const sent = await this.sendInputText(node, node.prompt);
    if (sent !== "sent") return sent;
    this.state = { ...this.state, retries: 0 };
    return this.setWaiting({ kind: "input", nodeId: node.id, expiresAt: this.inputExpiry(node) });
  }

  // ── Conditions and actions ────────────────────────────────────────────

  private async follows(): Promise<boolean | null> {
    if (this.followsCache === undefined) this.followsCache = await this.io.followsAccount();
    return this.followsCache;
  }

  private async evaluate(rule: FlowRule): Promise<boolean> {
    const contact = this.contact;
    const equalsCI = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const containsCI = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase());
    switch (rule.subject) {
      case "follows": {
        // Unverifiable follow status counts as following (fail open), the
        // same choice as the campaign follow-gate: never trap a real follower.
        const follows = (await this.follows()) ?? true;
        return rule.op === "is_false" ? !follows : follows;
      }
      case "tag": {
        const has = contact.tags.some((t) => equalsCI(t, rule.value ?? ""));
        return rule.op === "has_not" ? !has : has;
      }
      case "email":
      case "phone": {
        const set = Boolean(rule.subject === "email" ? contact.email : contact.phone);
        return rule.op === "is_not_set" ? !set : set;
      }
      case "field": {
        const raw = rule.key ? contact.customFields[rule.key] : undefined;
        const value = raw === undefined || raw === null ? "" : String(raw);
        switch (rule.op) {
          case "is_set":
            return value !== "";
          case "is_not_set":
            return value === "";
          case "equals":
            return equalsCI(value, rule.value ?? "");
          case "not_equals":
            return !equalsCI(value, rule.value ?? "");
          case "contains":
            return containsCI(value, rule.value ?? "");
          default:
            return false;
        }
      }
      case "last_input": {
        const value = contact.lastInput ?? "";
        if (rule.op === "equals") return equalsCI(value, rule.value ?? "");
        if (rule.op === "contains") return containsCI(value, rule.value ?? "");
        return false;
      }
    }
  }

  private async patchContact(patch: ContactPatch): Promise<void> {
    this.contact = {
      ...this.contact,
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.tags ? { tags: patch.tags } : {}),
      ...(patch.customFields ? { customFields: patch.customFields } : {}),
    };
    await this.io.updateContact(patch);
  }

  private async applyAction(nodeId: string, action: FlowAction): Promise<void> {
    const contact = this.contact;
    switch (action.type) {
      case "add_tag": {
        const tag = this.render(action.tag).trim();
        if (tag && !contact.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
          await this.patchContact({ tags: [...contact.tags, tag] });
        }
        break;
      }
      case "remove_tag": {
        const tag = this.render(action.tag).trim().toLowerCase();
        await this.patchContact({ tags: contact.tags.filter((t) => t.toLowerCase() !== tag) });
        break;
      }
      case "set_field":
        await this.patchContact({
          customFields: { ...contact.customFields, [action.key]: this.render(action.value) },
        });
        break;
      case "clear_field": {
        const rest = Object.fromEntries(Object.entries(contact.customFields).filter(([key]) => key !== action.key));
        await this.patchContact({ customFields: rest });
        break;
      }
      case "webhook": {
        const scope = this.scope();
        const body =
          action.method === "GET"
            ? undefined
            : action.body?.trim()
              ? renderTemplate(action.body, scope, { json: true })
              : JSON.stringify(contactPayload(scope, this.flow));
        let result: { ok: boolean; status: number; json: unknown };
        try {
          result = await this.io.request(action, body);
        } catch (error) {
          // A failing webhook never stops the flow (ManyChat continues too).
          await this.io.record("ACTION", nodeId, {
            action: "webhook",
            ok: false,
            error: error instanceof Error ? error.message.slice(0, 200) : "Request failed",
          });
          return;
        }
        if (result.ok && action.saveResponse?.length) {
          const fields = { ...this.contact.customFields };
          for (const mapping of action.saveResponse) {
            const value = getPath(result.json, mapping.path);
            if (value !== undefined && value !== null && typeof value !== "object") {
              fields[mapping.key] = value as string | number | boolean;
            }
          }
          await this.patchContact({ customFields: fields });
        }
        await this.io.record("ACTION", nodeId, { action: "webhook", ok: result.ok, status: result.status });
        return;
      }
      case "notify":
        await this.io.notify(this.render(action.message));
        break;
      case "pause_ai":
        await this.io.setAiEnabled(false);
        this.contact = { ...this.contact, aiEnabled: false };
        break;
      case "resume_ai":
        await this.io.setAiEnabled(true);
        this.contact = { ...this.contact, aiEnabled: true };
        break;
    }
    await this.io.record("ACTION", nodeId, { action: action.type });
  }

  // ── Events from the contact ───────────────────────────────────────────

  private markInteracted(): void {
    if (!this.state.context.interacted) {
      this.state = { ...this.state, context: { ...this.state.context, interacted: true } };
    }
  }

  /** Contact replied while the run waited for its first interaction. */
  async onInteraction(): Promise<boolean> {
    const waiting = this.state.waiting;
    this.markInteracted();
    if (waiting?.kind !== "interaction") return false;
    await this.io.record("REPLIED", waiting.nodeId);
    await this.run(waiting.nodeId, waiting.contentIndex);
    return true;
  }

  /** Free text while an input step waits. Returns false when not consumed. */
  async onInput(text: string): Promise<boolean> {
    const waiting = this.state.waiting;
    if (waiting?.kind !== "input") return false;
    const node = this.node(waiting.nodeId);
    if (!node || node.type !== "input") return false;
    this.markInteracted();

    if (this.io.now().getTime() > new Date(waiting.expiresAt).getTime()) {
      await this.expire("No answer before the input step timed out");
      return false;
    }

    const check = checkInput(node.inputType, text);
    if (check.ok) {
      const now = this.io.now();
      if (node.saveTo === "email") {
        await this.patchContact({ email: check.value, emailCapturedAt: now });
      } else if (node.saveTo === "phone") {
        await this.patchContact({ phone: check.value, phoneCapturedAt: now });
      } else if (node.saveTo.startsWith("field:")) {
        const key = node.saveTo.slice("field:".length);
        await this.patchContact({ customFields: { ...this.contact.customFields, [key]: check.value } });
      }
      await this.io.record("INPUT_VALID", node.id, { type: node.inputType });
      this.state = { ...this.state, retries: 0 };
      await this.run(node.next ?? null);
      return true;
    }

    const retries = this.state.retries + 1;
    this.state = { ...this.state, retries };
    await this.io.record("INPUT_INVALID", node.id, { attempt: retries });
    if (retries > (node.maxRetries ?? 2)) {
      this.state = { ...this.state, retries: 0 };
      await this.run(node.onFail ?? null);
      return true;
    }
    const sent = await this.sendInputText(node, node.retryMessage || DEFAULT_RETRY_MESSAGES[node.inputType]);
    if (sent === "sent") {
      this.setWaiting({ kind: "input", nodeId: node.id, expiresAt: waiting.expiresAt });
    }
    return true;
  }

  /**
   * Postback or quick-reply tap on one of this flow's buttons. An identical
   * tap within LIMITS.doubleTapMs is a double tap and is ignored, so a
   * branch never runs (and sends) twice. Returns false when ignored.
   */
  async onTap(nodeId: string, buttonId: string): Promise<boolean> {
    this.markInteracted();
    const node = this.node(nodeId);
    if (!node) return false;

    const key = `${nodeId}|${buttonId}`;
    const now = this.io.now();
    const last = this.state.context.lastTap;
    if (last && last.key === key && now.getTime() - new Date(last.at).getTime() < LIMITS.doubleTapMs) {
      return false;
    }
    this.state = {
      ...this.state,
      context: { ...this.state.context, lastTap: { key, at: now.toISOString() } },
    };

    if (buttonId === SKIP_BUTTON_ID && node.type === "input") {
      await this.io.record("CLICKED", node.id, { buttonId, skip: true });
      this.state = { ...this.state, retries: 0 };
      await this.run(node.onFail ?? null);
      return true;
    }
    if (node.type !== "message") return false;

    const button = messageButtons(node).find((b) => b.id === buttonId);
    const quick = node.quickReplies?.find((q) => q.id === buttonId);
    if (!button && !quick) return false;
    await this.io.record("CLICKED", node.id, { buttonId });

    if (quick) {
      await this.run(quick.next);
      return true;
    }
    if (button?.type === "next") {
      await this.run(button.next);
      return true;
    }
    if (button?.type === "flow") {
      await this.io.startOtherFlow(button.flowId);
      await this.complete(node.id);
      return true;
    }
    return false;
  }

  /**
   * Free text while a message waits for a tap. In a comment-started run
   * whose waiting message offers exactly one route (the classic "Send it
   * to me" opener), typing "yes" counts as the tap. Returns false when the
   * text is left to keywords and the AI setter.
   */
  async onFreeTextWhileWaitingForTap(): Promise<boolean> {
    const waiting = this.state.waiting;
    this.markInteracted();
    if (waiting?.kind !== "buttons" || this.state.context.trigger !== "comment") return false;
    const node = this.node(waiting.nodeId);
    if (!node || node.type !== "message") return false;
    const routes = [
      ...messageButtons(node).filter((b) => b.type !== "url"),
      ...(node.quickReplies ?? []),
    ];
    if (routes.length !== 1) return false;
    return this.onTap(node.id, routes[0].id);
  }

  /** A delay step fired. */
  async onResume(nodeId: string): Promise<void> {
    const waiting = this.state.waiting;
    if (waiting?.kind !== "delay" || waiting.nodeId !== nodeId) return;
    const node = this.node(nodeId);
    if (!node || node.type !== "delay") {
      await this.complete(nodeId);
      return;
    }
    await this.run(node.next ?? null);
  }
}

export { decodeFlowPayload };
