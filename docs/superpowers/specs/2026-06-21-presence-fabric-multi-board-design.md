# Presence Fabric — Multi-Board Addressing & Consent (v2 vision)

**Date:** 2026-06-21
**Status:** 🟡 Vision spec — APPROVED shape, **parked until v1.0.0 (calibration) ships**.
Decomposes into ordered sub-specs; each gets its own spec → plan → build when started.
This document is the umbrella vision, not a single implementation plan.

## Context

Today the whole system assumes **exactly one board**: a single `ESP32_URL` environment
variable, read by both the MCP server (`mcp_server/index.ts` `BOARD_URL`) and the Python
hooks (`claude-hooks/matrix_signal.py` `BOARD_URL`). Every Claude session that can reach
that URL drives that one board.

The board's purpose has become **Claude's outward-facing channel** — emote, inform ("task
done"), grab attention ("input needed"), show work-in-progress (wait spinners). It builds
directly on the **presence protocol** north star: *one semantic message, many renderers*
(8×8 panel + desktop card today).

**The v2 want.** The user will have **multiple boards** physically placed around a space
(kitchen, office, garage, …). A Claude session should drive **specific** boards and leave
the others alone — e.g. work-in-the-office Claude updates the office board, never the
kitchen board that's quietly showing the weather. This must be **near-automatic**: once a
board is set up, the user should not be re-asked which board to use every session.

**The one-line architectural shift:** *single hardcoded board → a registry of
identified boards + a consent layer + an addressing layer that targets the right one(s).*

This is the literal extension of the presence north star: v1 had many *renderers* of one
message; **v2 makes "many renderers" many physical, individually-addressed, consented
display appliances.** Hence the name: the **Presence Fabric**.

## Decisions (from brainstorming, do not re-litigate)

1. **Two-key consent.** A board is driven by an LLM only when BOTH keys agree:
   - **Board-side policy (lives on the board, owner-controlled — the hard ceiling):** the
     board itself decides whether it may be driven at all, and how much. The board can
     always refuse. Its **home display** (e.g. weather) also lives here; "release" = the
     board falls back to home.
   - **Client-side enlistment (lives where each Claude runs):** each Claude install
     (laptop / PC / phone) keeps its OWN list of boards it's been granted, and what scope.
   Output happens only at the **intersection**. The **hands-off default falls out for
   free**: a board a client hasn't enlisted, or a board set to `off`, is never touched.

2. **Hands-off is the safe default; enlistment is explicit + persistent (opt-in).** A
   client never grabs a board just because it's reachable. The user enlists boards once
   ("also use the garage board for attention pings") and it sticks across sessions. The
   destructive direction (taking over a board) is the one requiring consent.

3. **Name-based addressing.** The board's **name** (`matrix2`, `office`, `kitchen`) is the
   stable handle. The board self-advertises (mDNS); the IP floats behind a **name→last-known-IP
   cache + re-resolve** fallback (mDNS is known-flaky in this project — CLAUDE.md prefers IP,
   so the cache is load-bearing, not optional).

4. **Architecture = Approach "1 + a sprinkle of 2" (incremental, but protocol-shaped).**
   Build incrementally on the existing autonomous-board + HTTP-API design (no hub, no broker),
   BUT shape each board's self-description as a small **identity / consent / capability
   descriptor** from day one — so it's a real (if minimal) protocol, not bolted-on settings.
   That descriptor is what later lets a higher-res or third-party display "just work."

5. **Board = consented network appliance; Claude client = controller.** Mental model is a
   smart-home device (Govee / Matter / HomeKit shape): the appliance advertises identity +
   capabilities + consent; any number of controllers bind within those bounds. We do NOT
   adopt those wire protocols — only the mental model.

6. **No central hub/broker (Approach 3).** Noted as an escape hatch for a hypothetical
   "10+ boards centrally orchestrated" future; not built. Each board stays self-contained.

7. **Multi-client conflict on one board = last-writer-wins + the existing presence model.**
   Not solving priority/locking now.

## The model

```
┌─ Board (appliance) ──────────────────┐        ┌─ Claude client (controller) ─┐
│  identity:   name, id (MAC), hw type │        │  enlistment list:            │
│  consent:    llm_drivable            │◀──────▶│   { name → {addr, scope} }   │
│              (off|attention|full),   │  two-  │  name→IP cache (mDNS+fallback)│
│              client allow-list?      │   key  │  default board               │
│  home:       fallback display        │ consent│                              │
│  control:    existing HTTP API       │        │  (laptop / PC / phone each   │
│  descriptor: /api/identity /consent  │        │   keep their OWN list)       │
│              /capabilities           │        └──────────────────────────────┘
└──────────────────────────────────────┘
        output = board.policy ∩ client.enlistment   (else: hands-off)
```

## Decomposition — ordered sub-specs

Each is its own spec → plan → build, written just-in-time when started.

### Sub-spec 1 — Board identity & consent (firmware + settings) — FOUNDATION
Give a board a `name`, a `llm_drivable` policy (`off | attention-only | full`, with an
optional client allow-list), and a **home display** it falls back to. Expose the
descriptor: `GET /api/identity` (name, id/MAC, hardware kind e.g. `8x8-ws2812`),
`GET /api/consent` (drivable? scope? allow-list), `GET /api/capabilities` (renderable
modes). **Backward-compatible:** today's single board auto-gets a default name + `full`,
so nothing breaks. Everything else respects this; it's the ceiling.
- Open Qs for its spec: where home-display config lives (reuse `boot_animation`/settings?);
  whether `attention-only` is enforced firmware-side (reject non-attention payloads) or
  honored client-side (or both — defense in depth); how a board is named in the setup flow.

### Sub-spec 2 — Client enlistment & name-based addressing (MCP + hooks) — MVP partner
Retire the single `ESP32_URL` in favor of a **client-side enlistment config** (per board:
name, granted scope) + a **name→IP resolver** (mDNS advertise + cache/re-resolve). MCP
tools gain an optional `board` target (default = the enlisted default board); the Python
hooks fire to the enlisted set. Both **refuse** non-enlisted boards or over-scope requests
(client-side enforcement of the two-key rule, with the board as backstop). **Backward-compat:**
the current `ESP32_URL` board is auto-enlisted as the default, so existing single-board
users are unaffected.
- Open Qs: config format + location (per-machine file vs project vs user-global — the
  enlistment "lives where Claude runs"); how `matrix_express` & friends take a `board`
  arg without bloating every tool; how the hooks know the enlisted set; conversational
  grant/revoke ("use matrix2 for attention", "let go of the kitchen board").

> **MVP / first demonstrable slice = Sub-spec 1 + 2.** Name two boards, set the kitchen to
> `off`, enlist the office board on the laptop → Claude drives only the office board, by
> name, and won't touch the kitchen. The whole idea proven end-to-end.

### Sub-spec 3 — The consent handshake (protocol formalization)
The client reads a board's descriptor and honors its ceiling BEFORE driving it. Likely
folded into Sub-spec 1's build, but called out so the "protocol, not bolted-on settings"
discipline (the sprinkle of Approach 2) is explicit and the descriptor stays a clean,
versioned contract.

### Sub-spec 4 — Multi-board control UX (conversational + web)
How the user enlists / releases / resets from Claude ("use matrix2 for attention pings",
"release the kitchen board → home display") and how the **web UI** handles many boards:
one page that manages/configures the whole set, vs per-board pages reached by name. Its own
mini-design (the single-board `settings.html` doesn't obviously generalize).
- Open Qs: does a web page on board A let you configure board B (cross-board control), or
  is each board's page only itself + a "known boards" directory? How does the user discover
  a board's name to type into a client?

### Sub-spec 5 — Generalization to other display types
Capability-driven rendering so a higher-res or third-party display that speaks the
descriptor "just works." The `hardware`/`capabilities` fields from Sub-spec 1/3 are what
unlock this. Furthest out; design when a second hardware type actually exists (YAGNI until
then).

## Non-goals / explicitly deferred

- **No central hub/broker** — escape hatch only (Decision 6).
- **No multi-client priority/locking** — last-writer-wins + presence model (Decision 7).
- **Not built until v1.0.0 (calibration Phase 4) ships.** This is a parked roadmap doc; the
  immediate priority remains finishing the calibration milestone.
- **No new wire protocol stack** (Matter/etc.) — only the appliance/controller mental model.

## Why the ordering

Sub-spec 1 is the ceiling everything respects, so it's first. Sub-spec 2 is the client side
that actually addresses + enforces; together (1+2) they're the smallest end-to-end win. 3
formalizes what 1 implies. 4 is UX polish once the mechanism works. 5 waits for real second
hardware. This keeps each step independently shippable and testable, and never designs ahead
of need.

## Open vision-level questions (to resolve when sub-specs are written)

- **Enlistment scope/home:** per-machine vs per-project vs per-user-global config (Decision 2
  says "lives where Claude runs" + persistent; exact home decided in Sub-spec 2).
- **Setup flow:** the user's imagined flow is: plug board in → board's own web portal → wifi
  setup → settings page → set home display + `llm_drivable` → name it → tell a Claude client
  "use `<name>`." Confirm/refine in Sub-specs 1 & 4.
- **Discovery vs naming:** Decision 3 is name-first; whether clients also offer a "scan the
  LAN and show me boards to enlist" convenience is a Sub-spec 2/4 nicety.

## Relationship to existing work

- Extends the **presence protocol** (`docs/superpowers/specs/2026-06-17-presence-protocol-v0-design.md`)
  — same "one message, many renderers," now many physical renderers.
- Builds on **board discovery** (CLAUDE.md "Board discovery": the single `ESP32_URL` both the
  MCP and hooks read) — this is the thing that generalizes.
- Reuses the existing **settings** (NVS) machinery for board-side identity/consent/home, and
  the existing **HTTP API** as the control surface.
