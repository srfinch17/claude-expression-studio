// studio/intent-info.js, curated, human-readable "fires when" descriptions for each
// manifest intent, derived from the Claude Code harness moment map
// (manifest.harnesses["claude-code"].moments: hook:* -> intent) and the hook semantics.
// The editor shows INTENT_FIRES[intent], falling back to the manifest's terse `doc`.
// Hook-fired intents name their trigger; discretionary and fallback-only intents say so.

export const INTENT_FIRES = {
  info:            "Neutral status floor. Shown for general information, and whenever a more specific intent has no binding and falls back here.",
  working:         "Fires when you submit a prompt (Claude starts working) and when you answer a question or approve a plan (work resumes).",
  done:            "Fires when Claude finishes its turn: the response is complete (the Stop hook).",
  attention:       "Fires when the harness shows a permission prompt that needs your approval to continue.",
  fail:            "A setback or something wrong. Root of the error family; shown when error/fatal fall back here.",
  idle:            "Ambient / away: the quiet presence shown when nothing is happening (distinct from the screensaver rotation).",
  thinking:        "Reasoning hard. Set via presence; falls back to working if unbound.",
  heard:           "Acknowledges that your message was received. Set via presence; falls back to working.",
  compacting:      "Fires before the conversation context is compacted/summarized (the PreCompact hook).",
  "session-start": "Fires when a Claude Code session starts or resumes (the SessionStart hook).",
  "session-end":   "Fires when the session ends (the SessionEnd hook).",
  "results-merged":"Fires when a subagent (a delegated Task) finishes and reports back (the SubagentStop hook).",
  approve:         "Acknowledgement / thumbs-up. Falls back to done.",
  ok:              "Acknowledged. Falls back to approve → done.",
  question:        "Asking the human. Falls back to awaiting-input.",
  celebrate:       "Discretionary: Claude fires this on a win or milestone.",
  delight:         "A pleasant surprise. Falls back to celebrate.",
  "awaiting-input":"Fires when Claude requests a human decision: the harness pauses until you answer (AskUserQuestion, or plan approval via ExitPlanMode).",
  alert:           "Active look-here: a silent shoulder-tap. Falls back to attention.",
  error:           "An error occurred. Falls back to fail.",
  fatal:           "Discretionary: something died / crashed. Falls back to error → fail.",
  sleep:           "Resting: the quiet idle glyph. Falls back to idle.",
  screensaver:     "Discretionary: the ambient screensaver rotation of firmware apps when the board is idle. Falls back to idle.",
  greet:           "Hello. Set via presence; falls back to info.",
  affection:       "Warmth. Set via presence; falls back to info.",
  fun:             "Playful. Set via presence; falls back to info.",
};
