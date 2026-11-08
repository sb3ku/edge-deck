# Brag Plan: Edge Deck

## What is this app?
A touchscreen dashboard for the Corsair XENEON EDGE (a 14.5" 2560 × 720 touch strip) that puts your music, 3D printers, weather and AI coding agents on one ultra-wide screen, running quietly from the tray.

## The angle
Everything you keep alt-tabbing to check lives on one strip under your monitor. The video treats the strip as the hero: a thin 32:9 band of light opens into the real dashboard, then zooms into the live moments that make it feel alive. These are an agent ticking through its steps, a print finishing, a full-screen player sliding down into a mini player, and a sky that changes with the weather. It's an Apple-calm, premium product film for a hobby project built with obvious care.

## Hook (first 2-3 seconds)
Black screen. A single thin horizontal line of blue light draws across the frame and opens vertically into a 32:9 band, landing on the first strong cue (1.60s). The band's dimensions appear beside it: **2560 × 720**. Then **"One strip."** settles in, big, inside the band. (Built version: the longer "One strip. Everything at a glance." could not meet the ~2.3 s reading floor in the 1 s left after the strip opens, so the hook keeps two words and scene 2's caption names everything on the strip.) The odd shape is the hook, because nobody has seen a screen that wide and short.

## Key moments (the middle)
- **The whole deck lights up.** The real dashboard layout fills the band, and its cards rise in one by one: clock, weather, agents, printers, music.
- **Agents at work.** The Claude Code chat card: "Add hourly forecast" with the "Editing files" status and its step list ticking checkmarks ("Read the forecast API", "Add the hourly strip"), next to the Codex card "Fix checkout totals" with "Running commands". The animated orb glows.
- **A print finishes.** Studio H2D's progress bar runs 63% → 100%, "Printing" flips to a clear finished state, and the AMS spools sit in their real colours.
- **Music slides down.** The full-screen "Golden Hour" player slides down into a mini player above Home / Search / Your Library, just like the README describes.
- **The sky changes.** The weather card's animated sky cross-fades through clear → partly cloudy → sunset → night, backing the claim "24 conditions, each for day, sunrise, sunset and night".

## Outro / punchline
The full deck returns at a small scale and the band narrows back to a line. The **Edge Deck** logo and wordmark land on a strong cue (22.65s) with **"For the Corsair XENEON EDGE."** underneath. Then a soft music fade.

## User flow worth showing
Entry → glance → act, taken from the working app (not a marketing page):
1. The dashboard comes up full screen on the strip (tray app → full screen).
2. Something you care about updates live: an agent finishes a step, a print hits 100%.
3. You touch it: tap the music card and the player slides into the mini player.

## Tone
- Preset: polished (with app-store feature-card clarity)
- Creative direction: quiet premium hardware-accessory film, Apple keynote calm on a black stage
- Interpretation: few words, long readable holds, slow soft crossfades and slides, and motion that comes from the UI itself (progress, checkmarks, slide-down) instead of effects. Confidence through restraint.

## Format: landscape — 1920x1080
## Duration: 22.5s (target)

## Visual identity (from the project)
- Background: `#000` (with the subtle radial glows from `theme.css`: `rgb(10 132 255 / 9%)` top-left, `rgb(191 90 242 / 7%)` bottom-right)
- Card surface: `linear-gradient(180deg, #212123 0%, #1c1c1e 60%)`, radius 28px, 1px `rgb(255 255 255 / 6%)` border
- Accent: `#0a84ff` (text accent `#64a8ff`)
- Text: `#f5f5f7`, secondary `rgb(235 235 245 / 60%)`
- Status colours: green `#30d158`, amber `#ffd60a`, red `#ff453a`; Codex `#10a37f`, Claude `#d97757`, ChatGPT `#a78bfa`
- Display font: SF Pro Display → fallback "Segoe UI Variable Display" / "Segoe UI" (the app's own stack, `--ui-font`)
- Body font: same stack (SF Pro Text / Segoe UI Variable)
- Strongest visual element: the 2560 × 720 full dashboard (`docs/dashboard.png`), plus the animated weather skies (`docs/weather-skies.png`) and the music player (`docs/music-player.png`)

**Data note:** all source screenshots in `docs/` use the project's sample data ("Sample Artist", "Studio H2D", "Desk P1S", Berlin). Only that sample data goes on screen. Nothing from `artifacts/` (which may hold real local data) is used, and no Bambu Lab printer photos are used (they belong to Bambu Lab; the dashboard's own isometric print preview and printer icon are fine).

## Share copy (draft)
Built Edge Deck: one 2560 × 720 touch strip under my monitor for my music, Bambu printers, weather and AI coding agents. Open source, Windows, no telemetry.

## Audio direction
- Role: warm bed with sparse, professional, motion-matched accents
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM, bright but not loud; strong cues land early, so it suits a hook at 1.6s)
- Music treatment: start at 0s, quick 0.3s fade-in, sit at a moderate bed level, fade out over the last ~1.2s after the logo lands
- Music cue guidance: preset read (`assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.md`). Strong cues to target: **1.60s** (strip opens), **8.96s** (cut to agents close-up), **22.65s** (logo glow peak; the logo itself lands on the 20.54s beat so it can be read). Beat-grid window for the card cascade: 4.23 → 6.34s (snap to every beat: these are card entrances, not reading text). Checkmark ticks in the agent scene: every other beat from ~10.01s (10.01, 11.06).
- Audio-reactive treatment: subtle; music RMS gently lifts the blue band glow (hook/outro) and the card-edge glow. No waveform or equalizer visuals.
- SFX posture: sparse; low HF-risk files only
- Audio-coupled moments: strip opening (soft impact), card cascade (soft card-place per card), checkmark ticks (tiny click), print reaches 100% (light glass/plate chime), player slide-down (card slide), logo (soft bell, very restrained)
- Restraint rule: no sound on every animation; never louder than the music bed; nothing harsh or comedic. This is a calm product film.

## Storyboard

### Scene 1: The strip — 0.0–3.7s (3.7s)
Black stage. A hairline of `#0a84ff` light draws across the centre, then opens vertically into an empty 32:9 rounded band (≈1800 × 506) at 1.60s. A small "2560 × 720" label fades in at the band's corner. The line **"One strip."** blurs in inside the band at ~1.72s and holds until 3.44s (≈1.5s settled, 2 words).
Sequential/interaction: none
Audio intent: anticipation, then a soft "open"
Audio-coupled idea: soft impact as the band opens on 1.60s
Music: bed starts
Transition mood: soft → Scene 2 (the band stays; the dashboard fills it)

### Scene 2: The deck — 3.7–8.96s (5.26s)
The band becomes the real dashboard: the top bar ("Edge Deck · Overview", "Edit layout", "Customize") fades in, then the five cards rise in left to right on the beat grid (4.23, 4.75, 5.28, 5.80, 6.34): clock/weather "Sunday 8 November 01:02, Berlin 10° Partly cloudy", weather, agents ("2 working"), printers ("2 printers"), music ("Golden Hour"). A title above the band settles in at ~6.5s and holds to 8.7s: **"Music, 3D printers, weather and AI agents."**
Sequential/interaction: yes. Five cards arrive one per beat; the caption appears only after the cascade, so reading isn't rushed.
Audio intent: things clicking into place, building
Audio-coupled idea: card-place per card, quiet
Transition mood: clean push-in → Scene 3 (camera zooms into the agents card)

### Scene 3: Agents at work — 8.96–12.65s (3.69s)
Zoom into the agents card, scaled up big. Claude Code chat "weather-app · **Add hourly forecast** · Editing files" with its orb animating. The steps tick: "Read the forecast API" ✓ (10.01s), "Add the hourly strip" ✓ (11.06s). The Codex card above shows "Fix checkout totals · Running commands". Caption: **"Your AI agents, at a glance."** (in at 9.3s, holds to 12.4s)
Sequential/interaction: yes. Checkmarks tick on every other beat.
Audio intent: quiet competence
Audio-coupled idea: tiny click per checkmark
Transition mood: slide → Scene 4

### Scene 4: A print finishes — 12.65–16.34s (3.69s)
The printers card, scaled up: "Studio H2D · Bambu Lab H2D · Desk organiser". The progress bar and percentage count 63% → 100% (12.65 → 14.3s), the layer counter "118/186" runs up to "186/186", and the status flips from blue "Printing" to green "Finished". Below, "Desk P1S · Ready to print" with its four AMS spools (PLA white, PETG black, PLA red, ABS blue). Caption: **"Bambu Lab printers, live."** (in at 13.0s, holds to 16.1s)
Sequential/interaction: yes. Counter up, then a status flip.
Audio intent: small satisfaction
Audio-coupled idea: light chime on 100%
Transition mood: slide → Scene 5

### Scene 5: Music and sky — 16.34–20.02s (3.68s)
Split frame. Left: the full-screen "Golden Hour / Sample Artist" player (purple gradient, big pause button) slides **down** into a mini player bar above the Home / Search / Your Library tabs at ~16.9s (simulated tap/swipe-down). Right: the weather card's sky cross-fades clear-day → partly-cloudy → sunset → night (one per beat pair, as accents). Caption: **"An animated sky for 24 conditions."** (6 words; in at 17.4s, holds to 19.8s ≈ 2.4s. Grounded in the README's "animated sky with 24 conditions".)
Sequential/interaction: yes. Simulated swipe-down on the player; the sky sequence is non-text.
Audio intent: lift
Audio-coupled idea: card-slide on the player slide-down
Transition mood: soft crossfade → Scene 6

### Scene 6: Outro — 20.02–22.5s+ (≈2.5–3.0s)
The blue hairline draws back across the frame, echoing the opening (built version: the planned return of the full deck was dropped, as it could only have held ~0.3s before the logo). The Edge Deck app icon and wordmark land at **20.54s** (a beat-grid point, so the logo holds for well over 1.5s); the logo glow peaks on the strong cue at **22.65s**. Under it: **"For the Corsair XENEON EDGE."** Hold, then fade to black with the music at ~23.5s.
Sequential/interaction: none
Audio intent: settle, resolve
Audio-coupled idea: soft bell under the logo, very quiet
Transition mood: fade to black

Total: 3.7 + 5.26 + 3.69 + 3.69 + 3.68 + ≈3.5 = **≈23.5s**

**Music mood for this video:** upbeat but calm, premium
**Audio summary:** a bright bed that opens with the strip, a few quiet card/click/chime accents tied to real UI moments, and a soft bell and fade under the logo.

Credit (required by the music licence, CC BY 4.0): "Music: Sascha Ende, ende.app (CC BY 4.0)".
