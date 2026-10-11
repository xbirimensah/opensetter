# Decisions log

Decisions made while the owner was away, scored with a weighted matrix.
Criteria and weights: safety and reversibility 30, fit to the stated goal 25,
Meta, legal and platform compliance 15, effort and time 15, maintainability 15.
Scores are 1 to 5; the total is the weighted average.

## 2026-10-12: Flows (ManyChat rebuild for Instagram)

### 1. Flow editor style

| Option | Safety | Fit | Compliance | Effort | Maint. | Total |
|---|---|---|---|---|---|---|
| Structured step list with routing pickers | 5 | 3 | 5 | 4 | 4 | **4.20** |
| Free canvas (React Flow, like ManyChat) | 4 | 5 | 5 | 2 | 3 | 3.95 |
| Raw JSON editor | 5 | 1 | 5 | 5 | 3 | 3.70 |

Picked the step list. A canvas can come later on the same graph JSON; nothing in the data model is tied to the editor.

### 2. "Message people when they follow me"

ManyChat's "Follow to DM" runs on a Meta partner-only beta. The public Instagram webhooks have no follow event (checked Meta's webhook field list and changelog through 2026).

| Option | Safety | Fit | Compliance | Effort | Maint. | Total |
|---|---|---|---|---|---|---|
| Store a `new_follower` trigger, fire it only when Meta delivers follow events | 5 | 3 | 5 | 4 | 4 | **4.20** |
| Skip it | 5 | 1 | 5 | 5 | 5 | 4.00 |
| Browser automation that watches new followers and DMs them | 1 | 5 | 1 | 2 | 2 | 2.30 |

Browser automation scored lowest: it breaks Instagram's terms and risks a ban on the connected account.

### 3. Deploy tonight or stage for the morning

| Option | Safety | Fit | Compliance | Effort | Maint. | Total |
|---|---|---|---|---|---|---|
| Stage on the server, deploy with the owner in the morning | 5 | 3 | 5 | 5 | 4 | **4.35** |
| Deploy tonight, flows off by default, rollback ready | 4 | 5 | 5 | 3 | 4 | 4.25 |
| Deploy tonight, everything on | 3 | 5 | 5 | 3 | 4 | 3.95 |

The live instance answers real leads overnight (AI setter, follow-ups), and the first comment campaign was days away, so waiting cost nothing.

### 4. Where uploaded and inbound media live

| Option | Safety | Fit | Compliance | Effort | Maint. | Total |
|---|---|---|---|---|---|---|
| Local disk (`MEDIA_DIR`, default `./data/media`) | 4 | 5 | 5 | 5 | 4 | **4.55** |
| S3 / R2 bucket | 4 | 4 | 5 | 2 | 4 | 3.85 |

### 5. Inbound media (voice notes, photos)

Meta's CDN links expire, so a stored URL alone stops playing after a while.

| Option | Safety | Fit | Compliance | Effort | Maint. | Total |
|---|---|---|---|---|---|---|
| Download a copy when the message is mirrored | 4 | 5 | 4 | 4 | 4 | **4.25** |
| Proxy the CDN URL on view only | 5 | 2 | 5 | 5 | 4 | 4.10 |

### 6. Where comment triggers live

| Option | Safety | Fit | Compliance | Effort | Maint. | Total |
|---|---|---|---|---|---|---|
| Reuse campaigns (`Automation.flowId`) | 5 | 4 | 5 | 5 | 4 | **4.60** |
| New comment trigger type inside flows | 4 | 5 | 5 | 2 | 3 | 3.95 |

Reusing campaigns keeps the post picker, keyword matching, public reply rotation, dedupe, rate limits and the polling reconciler that already work.

### 7. Flows and the AI setter

| Option | Safety | Fit | Compliance | Effort | Maint. | Total |
|---|---|---|---|---|---|---|
| A flow consumes only what it asked for (input answers, first reply after a private reply, its buttons, its keywords) | 4 | 4 | 5 | 4 | 4 | **4.15** |
| Block the setter during any active run | 4 | 3 | 5 | 5 | 4 | 4.05 |

### 8. Voice note transcription for the AI setter

| Option | Safety | Fit | Compliance | Effort | Maint. | Total |
|---|---|---|---|---|---|---|
| Not now; the setter sees "[Voice message]" | 5 | 3 | 5 | 5 | 5 | **4.50** |
| Transcribe with an external Whisper API | 3 | 4 | 3 | 3 | 3 | 3.25 |

Sending prospects' voice notes to a third party needs a privacy decision from the owner first.

### Owner decisions (asked, not scored)

- Lead magnet link: a shared document (anyone with the link can view).
- Captured emails go to the owner's CRM only, with `consent=false` (never to the newsletter).
- Flow shape: button first (private reply with "Ja, schick her"), then email, then the link.
