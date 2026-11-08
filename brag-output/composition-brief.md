# Hyperframes Composition Brief: Edge Deck

## Objective
Create a short launch-style brag video for Edge Deck.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: ≈23.5 seconds

## Source Material
- Project root: `C:\Users\Seb\Documents\ChatGPT\3D\edge-deck`
- Primary files read: `README.md`, `package.json`, `src/theme.css`, `docs/dashboard.png`, `docs/music-player.png`, `docs/weather-skies.png`
- Product name: Edge Deck
- Tagline / strongest claim: "A touchscreen dashboard for the Corsair XENEON EDGE (the 14.5" 2560 × 720 touch display)… music, 3D printers, weather and AI coding agents at a glance."
- Key UI to recreate: the 2560 × 720 dashboard (`docs/dashboard.png`): top bar, clock+weather card, weather card, agents card, printers card, music player card. Recreate it in HTML so its parts can animate; the PNG is the layout reference.
- Copy that must appear verbatim (on-screen captions are grounded in the README):
  - "2560 × 720"
  - "One strip." (framing line)
  - "Music, 3D printers, weather and AI agents."
  - "Your AI agents, at a glance."
  - "Bambu Lab printers, live."
  - "An animated sky for 24 conditions."
  - "Edge Deck" / "For the Corsair XENEON EDGE."
- In-UI sample data (from `docs/dashboard.png`, sample data only): "Sunday 8 November", "01:02", "Berlin", "10°", "Partly cloudy", "H:14° L:4°"; Codex "shop · Fix checkout totals · Running commands · Running the checkout tests."; Claude Code "weather-app · Add hourly forecast · Editing files · Wiring the hourly forecast into the main view." with steps "Read the forecast API", "Add the hourly strip"; "2 working"; "Studio H2D · Bambu Lab H2D · Desk organiser · 63% · 118/186 | -48m · Printing"; "Desk P1S · Bambu Lab P1S · Ready to print" with spools PLA (white), PETG (black), PLA (red), ABS (blue); "Golden Hour · Sample Artist · Playing on Living Room PC"; bottom tabs "Home · Search · Your Library".

## Creative Direction
- Tone preset: polished (with app-store feature-card clarity)
- Creative direction: quiet premium hardware-accessory film, Apple keynote calm on a black stage
- Interpretation: few words with long readable holds; soft crossfades, slides and push-ins; motion comes from the UI itself (progress, checkmarks, slide-down, sky change).
- Angle: everything you keep alt-tabbing to check lives on one strip under your monitor. The 32:9 strip is the hero: a hairline of blue light opens into the real dashboard, then the camera visits the live moments.
- Hook: a blue hairline draws across black and opens into an empty 32:9 band at 1.60s, with "2560 × 720", then "One strip."
- Outro / punchline: the full deck in the band, the band narrows to a line, and the Edge Deck icon + wordmark + "For the Corsair XENEON EDGE." hold, then fade.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Bambu Lab printer photos (`src/assets/printers/*-photo.png`) and anything from `artifacts/` (may contain real data)

## Visual Identity
- Background: `#000` with radial glows `rgb(10 132 255 / 9%)` (top-left) and `rgb(191 90 242 / 7%)` (bottom-right)
- Card surface: `linear-gradient(180deg, #212123 0%, #1c1c1e 60%)`, radius 28px (scale with the card), border `1px solid rgb(255 255 255 / 6%)`, shadow `inset 0 1px 0 rgb(255 255 255 / 4%), 0 10px 30px rgb(0 0 0 / 35%)`
- Text: `#f5f5f7`; secondary `rgb(235 235 245 / 60%)` (convert to hex/rgb() if `check` needs it)
- Accent: `#0a84ff` (text accent `#64a8ff`); green `#30d158`; Claude `#d97757`; Codex `#10a37f`
- Display font: SF Pro Display isn't installable here → use "Segoe UI Variable Display" / "Segoe UI" (the app's own fallback), or a close local/registry Inter-style face if fonts must be bundled for render
- Body font: same family
- Visual references: `docs/dashboard.png` (layout), `docs/music-player.png` (player), `docs/weather-skies.png` (sky gradients for clear / partly cloudy / sunset / night), `src/assets/app/edge-deck.svg` (app icon)

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. The strip — 0.0–3.7s — hairline → 32:9 band at 1.60s; "2560 × 720"; "One strip."
2. The deck — 3.7–8.96s — dashboard fills the band; 5 cards rise on the beat grid (4.23–6.34s); caption "Music, 3D printers, weather and AI agents." holds 6.5–8.7s
3. Agents at work — 8.96–12.65s — agents card big; checkmarks tick at 10.01 and 11.06s; "Your AI agents, at a glance."
4. A print finishes — 12.65–16.34s — Studio H2D 63% → 100%, "Printing" → green "Finished"; Desk P1S spools; "Bambu Lab printers, live."
5. Music and sky — 16.34–20.02s — player slides down into the mini player above Home/Search/Your Library; sky cross-fades through four looks; "An animated sky for 24 conditions."
6. Outro — 20.02–23.5s — hairline → icon + "Edge Deck" + "For the Corsair XENEON EDGE." (logo lands 20.54s, glow peak 22.65s), fade out

## Audio
- Audio role: warm bed with sparse, professional, motion-matched accents
- Audio arc: bed opens with the strip, quiet accents on real UI moments, soft bell and fade under the logo
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`
- Music treatment: start at 0s, 0.3s fade-in, moderate bed, ~1.2s fade-out at the end
- Music cue guidance: bundled preset `~/.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json` (114.84 BPM). Strong cues: 1.60s (strip opens), 8.96s (agents push-in), 22.65s (logo glow peak). Beat grid: 4.23, 4.75, 5.28, 5.80, 6.34 (card cascade); 10.01, 11.06 (checkmarks).
- Audio-reactive treatment: subtle; RMS lifts the blue band glow and card-edge glow. No waveform/equalizer visuals.
- Audio-coupled moments:
  - Scene 1 band opens — soft impact
  - Scene 2 card cascade — quiet card-place per card
  - Scene 3 checkmarks — tiny click each
  - Scene 4 hits 100% — light chime
  - Scene 5 player slide-down — card slide
  - Scene 6 logo — very quiet bell
- SFX selection guidance: low HF-risk picks from `~/.claude/skills/brag/assets/sfx/sfx-analysis.md`; never louder than the bed
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density and volume based on the implemented animation.
- Audio files: copy the chosen music and SFX into `brag-output/composition/assets/`
- Credit: "Music: Sascha Ende, ende.app (CC BY 4.0)" (goes in share copy)

## Hyperframes Instructions
Load the composition-building Hyperframes skills: `hyperframes` (composition contract + `data-*` timing, `references/format.md`; motion in `references/motion.md`; look in `references/look.md`), `hyperframes-registry`, `media-use`, and `hyperframes-cli`. /brag is its own workflow: skip the storyline step (no `references/types/*`, `references/story.md`, storyline proposals or `SPEC.md`), and skip `usage`, `history`, `feedback` and REVIEW.md. `check` is the gate. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show real UI, copy and visuals from the project (sample data only).
- Keep all text readable in the final render.
- Keep the video within 15–25 seconds.
- Include the music and SFX layer.
- Music cues are optional hints; readability and story come first. 1–3 strong-cue locks.
- Use local assets; keep creation and rendering local.
- Run `hyperframes check` before render.
