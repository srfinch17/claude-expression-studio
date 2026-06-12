# Phase 4 · Calendar App — Design Spec
**Date:** 2026-06-09
**Roadmap:** Phase 4

## Overview
A `calendar` animation mode with **4 styles**, date from NTP (same plumbing as
the clock). Web page `calendar.html` is a single page with style buttons + the
**S2 palette** (first consumer) + brightness widget; home gets a Calendar card;
MCP gets a `calendar` mode.

## Styles (firmware `anim_calendar.ino` → `stepCalendarFrame()`)
- **scroll** — "TUE JUN 9" scrolls L→R (3×5 font, `drawStr3x5` at a decrementing
  `calendarScrollX`; wraps). Color = primary.
- **bignum** — day-of-month, big & centered (`drawStrCentered3x5`). Color = primary.
- **grid** — mini month: 7 cols (Sun–Sat) × week-rows; today = primary (bright),
  other days = secondary dimmed. First-of-month weekday derived from today's
  `tm_wday`/`tm_mday`; leap-aware days-in-month.
- **clock** — month over day via the clock's `drawTimeDisplay(month, day, …)`:
  month renders like hours (tiny 3×3 top), day like minutes (3×5 bottom), accent
  = colon/separator.

NTP: if `getLocalTime()` hasn't synced, show the wait indicator (same as clock).

## Update 2026-06-11
- **5th style: `square`** — a desk-calendar square: 2-letter weekday (3×3, rows
  0-2, color2) over the big day number (3×5, rows 3-7, color1). Two letters by
  deliberate choice: three 3×3 glyphs are 11px wide on an 8px matrix, and the
  pairs SU MO TU WE TH FR SA are unambiguous.
- **NTP wait indicator replaced** — the dim-white pulse read as "broken"; clock
  and calendar now share `drawNtpWaitFrame()` (clock_timer.ino): an animated
  amber hourglass with gold sand draining on a ~4s loop.
- `tz` (POSIX, DST-aware) is preferred over integer `timezone`; the page sends it.

## API
`POST /api/display/animation { type:"calendar", style, color1, color2, color3, timezone, speed }`
- color1 primary (day/today/text), color2 secondary (month/other days), color3 accent.
- timezone = UTC offset int (default -7). speed = ms/frame (drives scroll).

## Firmware
- New `anim_calendar.ino`. Globals (in main .ino): `calendarStyle`,
  `calendarColor1/2/3`, `calendarScrollX`. Dispatch branch + handler branch
  (reuses clock's `configTime` + `clockTimezone` + `ntpSynced`).

## Verification (flash + LittleFS)
Each style shows correct date; grid highlights today; clock-style mirrors clock
layout; scroll wraps cleanly; colors from palette apply; timezone affects date.

## Out of scope
- Live browser preview of the date (board shows it). Month names beyond EN.
