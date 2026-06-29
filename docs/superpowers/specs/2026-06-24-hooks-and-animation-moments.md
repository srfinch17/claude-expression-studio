# Hooks, Operations & Animation Moments — reference + idea catalog

Every place an animation could fire, what triggers it, how often it fires (the key
design constraint), and one fresh animation idea per moment. Companion to the
animation-roster doc. Frequency drives whether a moment wants a quick blip, a calm
loop, or nothing.

## Part 1 — Claude Code lifecycle hooks (host-side events)

Not all are "Claude fires it"; some are user/harness lifecycle events. Noted per row.

| Hook | Trigger / who | How often | What it means | Currently plays |
|---|---|---|---|---|
| **SessionStart** | Harness, on session begin/resume (matchers: startup, resume, clear, compact) | Rare (once per session) | Claude Code is booting / waking up | — |
| **UserPromptSubmit** | User submits a prompt (before Claude sees it) | Every prompt (frequent) | "You said something; I'm taking it in" | wait spinner |
| **PreToolUse** | Claude is about to run a tool (matchable by tool name; can block) | **Very frequent** (every tool call) | "About to act — Bash/Edit/Search/etc." | ask-question (AskUserQuestion, ExitPlanMode only) |
| **PostToolUse** | A tool finished successfully | **Very frequent** | "That tool is done" | wait (after Ask/Plan only) |
| **Notification** | Claude Code needs attention — permission request, or input idle ~60s | Occasional | "I need you / are you there?" | ask-attention (permission_prompt) |
| **Stop** | Main agent finished its turn | Every turn (frequent) | "I'm done responding" | done (+ arms idle) |
| **SubagentStop** | A subagent (Task tool) finished | Per subagent (bursty when parallel) | "A helper reported back" | — |
| **PreCompact** | Before context compaction (auto when full, or /compact) | Occasional | "Folding memory down to essentials" | — |
| **SessionEnd** | Session ends | Rare (once) | "Signing off" | — |

> **Frequency caveat:** PreToolUse/PostToolUse fire on EVERY tool call — an animation
> there must be a sub-second blip or it becomes strobe-spam. SessionStart/End/PreCompact
> are rare enough to afford a richer, longer set-piece.

### One fresh animation per hook (my ideas — colorful)

1. **SessionStart → "Warp-in portal"** — concentric rings spiral open from one center
   pixel outward, cycling cyan→violet→gold, settling into a steady ready-glow. *Booting,
   I'm online.* (blue/purple/gold)
2. **UserPromptSubmit → "Soundwave ingest"** — vertical bars jump like a rainbow
   equalizer (red→orange→yellow→green→blue) and pulse inward as if swallowing your words.
   *Heard you.* (full rainbow)
3. **PreToolUse → "Targeting reticle"** — green corner-brackets snap inward and lock on
   center with a cyan blip. Fast. *Locking onto a tool.* (green/cyan on dark)
4. **PostToolUse → "Stamp"** — a teal block slams down, squashes with a 1px shake, a green
   ✓ tick flashes. Quick. *Done, stamped.* (teal + green)
5. **Notification → "Lighthouse beam"** — a white tower at bottom; a warm amber beam
   sweeps across a deep-navy night sky, brightening as it points at you. *Look here.*
   (amber beam / navy / white)
6. **Stop → "Bloom"** — from a center bud, petals unfurl pink→magenta→gold, hold the open
   flower, gently close. Calm. *Finished — here's the result.* (pink/magenta/gold/green stem)
7. **SubagentStop → "Swarm merge"** — 3–4 differently-hued dots drift in from the edges,
   converge at center, flash white. *My helpers reported back / results merged.* (multi-hue
   → white) — thematically perfect for parallel agents.
8. **PreCompact → "Vortex fold"** — the field of scattered colored pixels spirals inward
   and compresses into one bright white point that pulses once. *Folding memory down.*
   (rainbow → white singularity) — perfect compaction metaphor.
9. **SessionEnd → "Dusk"** — a warm sun sinks below a horizon line as the sky shifts
   orange→magenta→deep-violet; the last pixel winks out. *Goodnight.* (sunset palette)

## Part 2 — Claude-initiated operations (deliberate, MCP-driven)

These aren't hooks — Claude *chooses* to fire them mid-work to emote or inform.

| Operation | What it does |
|---|---|
| **matrix_express(name)** | Show a canned/saved expression — Claude's emote vocabulary (the alert/cross/heart/mascot library we've been curating) |
| **presence_set(intent, …)** | Semantic status → 8x8 glyph + desktop card + native LED data (progress bar / sparkline / readout) |
| **matrix_idle** | Drop a random pre-approved ambient app on the board when bored |
| **matrix_set_animation** | Launch a firmware animation (fire, dancefloor, fireworks, …) — generative, needs a flash to add new ones |
| **matrix_show_text** | Scroll a short text message |

### Fresh emote ideas for matrix_express (incl. your two seeds)

- 💀 **Skull w/ purple glowing eyes** *(your seed)* — bone-white skull silhouette, two eye
  sockets pulsing violet→magenta, jaw rattles 1px. *Cursed code / fatal / spooky-playful.*
- 🪐 **Ringed planet** *(your seed)* — cream-banded planet with a glowing crimson storm-spot
  drifting across, cyan rings sweeping a shimmer. *Cosmic / big-picture / dreaming.*
- ⚡ **Lightning** — a white-yellow bolt cracks across a deep-blue cloud; the panel flashes.
  *Whoa / fast / error.* (blue + white-yellow)
- ⏳ **Hourglass** — amber sand falls from top chamber to bottom; flips when empty.
  *This'll take a bit.* (amber/gold on dark)
- 🧊 **Crystal ball** — a violet orb with swirling teal mist; a white glint blooms when an
  answer lands. *Thinking it through.* (violet/teal/white)

### Fresh ambient ideas for matrix_idle (board eye-candy)

- 🌌 **Aurora** — vertical curtains of green→cyan→violet sway and shimmer. (firmware-friendly)
- ✨ **Fireflies** — yellow-green dots blink and drift on black; occasional warm flares.

> **Build tier note:** the emotes + most hook ideas (portal, reticle, stamp, bloom, swarm,
> vortex, dusk, skull, planet, hourglass, crystal ball) are **frame-expressions** (T3 JSON
> loops — author with a script, zero flash). Aurora/fireflies/lightning-field read best as
> **firmware animations** (generative, parametric → need the add-animation flash path) but
> can be faked as short frame loops first to preview.
