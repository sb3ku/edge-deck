# Edge Deck interface

## Context and goals

An Apple-inspired dark companion panel for the 2560 × 720 XENEON EDGE. The clock, active chats, printers and music have distinct proportions and a quiet hierarchy. Keep the entire overview visible at native resolution. Use the installed Premium skill and Apple's [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) and [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) guidance as references; implement with local CSS and the platform system font.

## Design tokens and foundations

- Background `#0a0a0c`; panels `#1c1c1f`; raised surfaces `#252528`; controls `#303034`; inset fields `#131315`.
- Primary text `#f5f5f7`; secondary text `#a1a1a9`; hairline separators white at 10%.
- Accent `#0a84ff`; filled primary buttons `#0071e3` with white text; small accent text `#6eb1ff`.
- Success `#58d779`, attention `#ffca64`, error `#ff8a85`. State always has a text label.
- Font stack: Apple system fonts where available, then Segoe UI Variable / Segoe UI on Windows. Do not download proprietary fonts. Numerals use tabular spacing.
- Spacing rhythm: 4, 8, 12, 16, 20, 24 and 32 px. Native cards have 28 px corners; controls 12–16 px; toolbar controls and dock are capsules. Restrained hairlines establish elevation.
- Native typography: clock 128 px / 300; panel titles 22 px / 600; content titles 21–30 px / 600; body 16–17 px; metadata 14 px. Compact layouts reduce content typography while keeping touch targets.

## Component rules

**Overview.** A 54 px toolbar, flexible content area and compact centered dock. The clock occupies less horizontal space than the other modules. Flex sizing follows the visible/reordered widgets; hiding a widget must not leave a vacant column. Shortcuts scroll horizontally within their dock.

**Chats.** Only real, active local Codex chats. Each row shows title, current visible activity, optional public progress and elapsed duration. Preserve the user's requested restrained text shimmer and wave bars. Do not display reasoning, tool arguments, synthetic activity or duplicate working badges.

**Printers.** Two equal rows with original/custom model outline art, real status, phase, progress and temperatures. Use a quiet separator and disclosure chevron. The whole row is a keyboard/touch button, with a separately reachable Connect action. Never invent phase, ETA, routing or temperature values.

**Music.** Real album art, a clear title and quieter artist. Transport uses circular controls with a 64 px primary button at native resolution. The playlist button is visually separated. The volume slider has a 48 px hit area and represents Windows system volume. No fake progress timeline.

Music now has an internal Now Playing / Playlists segmented control. Use restrained rose accents like Apple Music, real covers, and a stable DOM so live updates do not steal focus or reset the selected view. The playlist library supports account results, search, refresh and local saved links. Play sends a request to an authenticated active Spotify device; Open in Spotify only opens a saved URI and must not claim playback started. Manual name/link drafts and slider edits remain local until committed. All transport and playlist actions retain 48 px targets even when the overview is compact.

**Weather.** A fifth, independently reorderable module sits after Clock in existing layouts. An atmospheric day/night surface reflects reported conditions; use simple local vector weather symbols, large current temperature, high/low and a four-hour strip. Tapping opens a centered forecast sheet with city search, Celsius/Fahrenheit, a 24-hour scroller, seven-day range bars and available measurements. Units and times follow the saved city; show no guessed values. Stale data is explicitly labelled. The city is editable; do not infer location from IP. Display Open-Meteo and GeoNames attribution. Reduced motion stops clouds/rain. Expanded forecast sections may scroll; the panoramic overview itself fits the display.

**Printer console.** Preserve the smooth card-to-console transition and Home / Controls / Filament rail. Home shows current phase/camera/print actions. Controls pairs the temperature editors and axis pad. Filament shows the reported AMS colors/routes. Selection uses blue; success/status uses green. Keep all capability reasons, confirmation behavior, connection settings and on-demand camera lifecycle intact. Reported values remain distinct from unsent drafts. Telemetry must preserve tab, draft and open confirmation.

**Settings.** A floating sheet with a close control, grouped forms and a segmented section switcher. Keep automatic-save outcomes and validation messages visible. Fields and section tabs have a minimum 48 px hit area. Sheets may scroll internally; compact windows must not clip their controls.

**States and motion.** Neutral controls have a visible hover surface; primary controls darken on hover; press uses a small scale change. Disabled controls use readable neutral labels and remain unavailable through existing logic. Keyboard focus uses a 3 px blue outline. Busy, error and unconfirmed states retain their explicit messages. Use short opacity/transform transitions; respect reduced motion, transparency and increased contrast. Polling never repeats entrance animation.

## Accessibility acceptance

- Action targets and slider hit areas must be at least 48 × 48 px in supported layouts.
- Body/metadata colors must reach 4.5:1 against their surfaces. Visible focus must remain distinguishable; never remove the outline from full-row printer buttons or dock controls.
- Keyboard traversal must reach setup, full screen, all printer tabs/actions, playlists and app shortcuts. Existing dialog semantics and confirmation defaults must remain intact.
- Keep unknown/offline information explicit; do not label cached readings as current.
- At 2560 × 720, 2048 × 576 and 1600 × 450 there must be no page overflow. At 900 × 700 the stacked layout intentionally scrolls. Long titles wrap or truncate without displacing actions.

## Content and tone

Use short, literal labels: Controls, Heatbed off, Home axes, Working for. Prefer specific outcomes and reasons over decorative taglines. Keep service disconnection notices visible. Do not expose machine names as primary UI content.

## Anti-patterns and migration

Replace the former blue/slate theme with shared neutral tokens across both stylesheets. Avoid arbitrary per-screen colors, a bright green primary action for everything, decorative charts, giant identical tiles and hardware slogans. Keep existing saved configurations and adapters. Do not remove requested activity animation or printer functionality to simplify the visuals.

## QA

Run syntax and existing automated checks, then the isolated browser verification. Inspect native, compact and stacked screenshots; inspect Home, Controls, Filament, Music and Settings. Verify focus, reduced motion, exact printer-confirmation behavior and persistence. Never send heating, movement, playback or volume changes to real devices while checking the redesign.


## Modular cards and layouts (0.8)

Cards are containers with stable IDs and zero to six named contents. A content can be Clock, Weather, working Codex chats, Printers, Music, a saved app shortcut or a saved HTTPS website preview. The chosen tab, card name, size, visibility and order persist. The quick-launch dock is separate. Each card has a quiet title toolbar, a 48px Edit action and, while editing the layout, a dedicated drag handle. Multi-content cards use an accessible tablist with arrow-key navigation and stable focus. Preserve live media and website DOM across polling, tab switches and supported state-preserving reorders.

Overview retains the panoramic weighted row and scrolls horizontally when the user adds more than can fit. Bento uses a 12-column forward-only grid: Small 2×1, Medium 3×1, Wide 6×1, Tall 3×2 and Large 6×2. Focus gives the first card six columns and two rows; remaining cards share the side. Smaller displays clamp spans to available columns and intentionally scroll. Avoid dense backfilling that changes visual reading order. Compact card bodies scroll when their controls cannot fit; never shrink touch targets or overlap readings.

A 450ms hold on card background or a dedicated handle starts a move. Movement before the threshold is scrolling intent and cancels the pending drag. Inputs, tabs, playback and other real actions do not start dragging. The weather and printer full-card open buttons permit a deliberate hold but still open on a quick tap. Use a quiet title preview and a blue before/after insertion indicator, announce position to assistive technology, suppress the release click, and save only on a valid drop. Escape, pointer cancellation or leaving the window cancels without changing order. Keep equivalent move buttons in settings. Reorder transitions respect reduced motion.

The gallery and editor use the same surfaces, action hierarchy, focus, field boundaries and feedback as all other sheets. Removal changes only the card or view and offers Undo. Saved credentials, apps and playlists remain separate. Website frames use only saved HTTPS destinations, a restrictive sandbox and no referrer, and must respect a site's embedding policy; offer Open website rather than bypassing it. Never imply an arbitrary Windows app is embedded.

`src/apple-ui.css` unifies controls, fields, tabs, disabled and destructive states across Layout, Apps, Music, Weather, Printers and Display. See `APPLE-DESIGN-REVIEW.md` for the concrete Apple HIG review, measured token contrast and explicit limits. This remains a Windows app; no Apple certification or native framework behavior is claimed.
