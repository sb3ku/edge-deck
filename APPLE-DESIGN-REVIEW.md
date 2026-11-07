# Edge Deck interface review

Reviewed 6 November 2026. The goal is a coherent, Apple-inspired touch dashboard that remains a Windows application: real status, familiar controls, restrained surfaces, and readable content on the 2560 × 720 XENEON EDGE. This is a design review against selected guidance, not Apple certification or a claim of full accessibility conformance.

## Context and goals

The review covers the overview, container layouts and editor, all settings panes, weather, music, printer controls, confirmations, and feedback states. `src/apple-ui.css` is the shared interaction layer, loaded after component styles. It does not position dashboard cards or replace component behavior.

Apple’s current guidance emphasizes familiar patterns, user agency, adaptation, and attention to details. Those principles inform consistency here; platform-specific macOS menus and native Liquid Glass are not recreated in a Windows web renderer. [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)

## Design tokens and foundations

| Role | Implementation | Reason |
| --- | --- | --- |
| Typeface | Segoe UI Variable / Segoe UI, then platform fallbacks | Uses the installed Windows system typeface; no bundled Apple fonts. |
| Canvas / card / inset | Existing `--background`, `--panel`, `--surface-inset` | Keeps functional layers distinct without adding decoration to every card. |
| Regular action | 12px radius, minimum 48 × 48 CSS px | One touch-control family; size does not imply a different action priority. |
| Group / sheet | 16px / 24px shared radii | Groups related controls and distinguishes temporary surfaces. |
| Primary action | Existing `--accent-button` blue | Reserved for the useful next action. Music’s rose accent remains local to music controls. |
| Destructive action | `--ui-danger-text` on `--ui-danger-surface` | Stop-print confirmation must be red and must not carry the primary class. |
| Focus | 3px opaque `--ui-focus`, 3px offset | Visible across dark surfaces; full-card controls use an inset ring to avoid clipping. |
| Fields | `--ui-field-border`, 12px radius, 48px minimum | Makes text, search, and numeric entry recognizable across modules. |
| Disabled | Opaque neutral surface and readable secondary label | Unavailability is distinct without making the label disappear. Actual disabled semantics stay in JavaScript. |

The 48px target is an Edge Deck requirement. Apple gives a general 44 × 44 point hit-region recommendation; CSS pixels and Apple points are not treated as interchangeable measurements. [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)

Static color-pair checks performed on the shared tokens:

| Pair | Contrast |
| --- | ---: |
| Primary text / card | 15.61:1 |
| Secondary text / card | 6.63:1 |
| White text / primary blue | 4.70:1 |
| Disabled label / disabled surface | 6.28:1 |
| Destructive text / destructive surface | 7.63:1 |
| White text / music primary rose | 5.92:1 |
| Input edge / inset field | 3.37:1 |
| Focus ring / hovered control | 5.46:1 |

These checks establish the token pairs, not every possible composited or transient frame. Regular text must remain at least 4.5:1; control boundaries and focus indicators are separately checked. Status text accompanies color. [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)

## Screen-by-screen audit and changes

| Screen or state | Concrete review finding | Applied treatment / remaining check |
| --- | --- | --- |
| Overview: clock and date | Large time, smaller date and timezone establish useful hierarchy. | Existing hierarchy retained; no fake data or decorative controls added. New container layouts need their final renders checked. |
| Overview: Codex chats | Activity text and bars already convey work; the user requested animation. | Wave and shimmer retained. Reduced-motion preference replaces animated text fill with readable static text and stops bars. |
| Overview: printer cards | Model art and phase/status have distinct roles. Full-card focus can be clipped by the card edge. | Inset focus ring preserved. Connect-printer buttons now share the 12px regular-action shape. Root’s final scoped rule places H2D/P1S side by side when a card is at most 360px high and at least 700px wide; narrow cards keep a scrollable list. Live/offline semantics remain the adapter’s responsibility. |
| Overview: media and app strip | Media has a useful rose identity; the app dock is navigation. New card chrome squeezed music text out at 1600 × 450. | Media accent and circular play control retained. Short cards use a compact album/title/artist arrangement with all three 48px transport controls visible; system volume remains reachable by scrolling. Regular buttons share geometry; the dock alone retains restrained background blur. |
| Containers: overview / bento / focus | Short rows hid Clock’s date and Music’s transport. | Root owns placement. The named `deck-card` height query adapts content hierarchy below 360px: smaller clock with date, current weather, compact media transport. Final native default five-card Bento/Focus and compact Overview artifacts confirm the fix. |
| Layout gallery and card editor | Selected modes, content rows and removal actions need explicit state and large targets. Initial mode/gallery cards duplicated the helper’s label and the content title. | Duplicate labels removed by the layout owner. Gallery/editor artifacts now show clear titles, previews, defaults and red removals. Inputs use the shared border token; focus returns to the meaningful control or Undo after removal. |
| Weather overview | Compact card chrome caused city, temperature and hourly rows to overlap; the first minimum-height fix did not cover wider Focus cards. | Removed the empty duplicate heading and corrected flex sizing to use content. Short cards now show city, current reading, condition, high/low and update/source without overlap; tap opens the full hourly/daily forecast. Atmosphere and preference support remain. |
| Weather detail / city search | Current conditions, hourly forecast, daily ranges and settings are grouped. The city search has meaningful empty/loading/error states. | Shared field edge, unit selection, result boundaries and sheet chrome. The previously corrected daily UV label remains “UV today (max)”. Forecast sources, stale age and unavailable readings remain visible. |
| Music Now Playing | Transport and system volume are separate functions. | Circular play control retained; other controls share 12px radii. Disabled controls stay readable. |
| Music Playlists | Search focus previously outlined only the inner rectangular input. | The entire rounded search field now receives a visible rose focus ring. Remove-playlist action is red. Existing fake-bridge tests cover preserved search, tab, drafts and asynchronous updates. |
| Music account settings | Connection state, one-time setup, Client ID and redirect are grouped, with actual busy/error text. | Uses the shared form, action and notice styles. No OAuth requests or playback are performed by this review. Native browser sign-in remains outside the visual audit. |
| Printer Home | Camera, job phase, temperatures and print actions form separate task groups. | Sheet header, close control, focus and disabled styles aligned. Preview remains explicit and no camera is opened by this review. |
| Printer Controls | Readings, target entry and physical movement have clear groups and labels. | Numeric fields now share the visible field edge; selected controls keep a border as well as color. No movement or temperature command is issued by this review. |
| Printer Filament | Slot and nozzle identity are visible, and unavailable actions are disabled. | Disabled tiles keep readable metadata and gain a dashed border; selected tiles retain explicit state. No filament command is issued. |
| Printer confirmations | The stop-print confirmation was created as a blue primary action. Cancel is already focused first. | Shared CSS includes a red destructive variant; root changed Stop print to `.danger` and removed `.primary`. Load, unload and movement confirmations remain separate from destructive stop. |
| Settings navigation | Tabs previously compressed to fit narrow windows. | Settings tabs keep at least 72px width / 48px height and scroll horizontally. Active tab remains visible and distinct. Content scrolls independently with bottom clearance. |
| Settings → Layout / Widgets | Visibility and ordering controls are action-heavy. | Shared 48px controls and focus, readable disabled arrows. New gallery/editor integration is reviewed after root’s render. |
| Settings → Apps | App names, saved website addresses and add actions have clear roles. | Existing content hierarchy retained; shared form edges and button geometry apply. Windows file picker is an OS dialog and is not restyled. |
| Settings → Weather | Settings leads directly to the weather location/unit view. | Contextual adjustment remains in Weather, rather than duplicating a second city form. |
| Settings → Printers | The two LAN checkboxes had explicit 24px input dimensions. | Each input now has a 48px hit area with a 24px visible mark. Labels and native checkbox semantics remain intact. Fields keep secrets obscured. |
| Settings → Display / startup | Startup uses a confirmed state and disables while saving; failure retains the confirmed setting. | Shared switch, field, button and notice treatment. Existing in-memory startup tests remain the behavioral evidence; no real Startup/Desktop changes are made in this review. |
| Toast, error, loading and empty states | Distinct modules used slightly different line heights and focus/disabled treatments. | Shared legible captions, feedback line heights and toast radius. Real module status text remains authoritative; no simulated progress or decorative loading spinner is introduced. |

Related content is grouped using spacing and quiet separators, while infrequent settings stay separate from in-context options. This follows Apple’s layout and settings guidance without imposing macOS window conventions on Windows. [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Settings](https://developer.apple.com/design/human-interface-guidelines/settings)

## Component rules and interaction states

- Regular actions use the shared 12px shape. Dismissal and media play are deliberate circular exceptions. Hover and press remain visible; keyboard focus does not rely on hover.
- Primary blue marks the next useful action, not a destructive operation. Music may use its scoped rose primary. Stop print uses the destructive role and Cancel receives initial focus.
- Form labels stay visible above values. Placeholder text is supplementary; read-only redirect text remains selectable. Error text supplements the invalid field border.
- A saved state remains visible until an asynchronous change is confirmed. Busy controls are actually disabled by their component; shared CSS only changes presentation.
- Long lists and tabs scroll within their own region. Touch controls are never shrunk to make a row fit. Card placement remains the layout module’s responsibility.
- Translucency stays restrained around navigation or modal separation. Content cards remain solid; weather atmosphere is a contextual illustration. This avoids scattering glass effects across every surface. [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)

## Accessibility acceptance criteria and evidence

Completed in an isolated browser fixture, without invoking production bridges:

- Checkbox hit area computes to 48 × 48px despite the old inline 24px dimensions.
- Settings tabs and regular actions compute to at least 48px high; tabs retain at least 72px width on a 390px viewport.
- At 390px, tabs scroll horizontally without document-level horizontal overflow.
- Shared token contrast pairs were calculated as listed above.
- Source review confirms explicit reduced-motion, reduced-transparency, increased-contrast and forced-color handling. Preference rendering still needs final integrated screenshots.

An additional isolated file-preview check exercised all six settings panes (Layout, Apps, Music, Weather, Printers, Display). Every visible button, input, select and disclosure target was at least 48 × 48px, and no pane caused document-level horizontal overflow. The Apps pane also passed at 390 × 700. Closing Settings returned focus to Customize. This preview made no production bridge calls and reported zero script errors.

Updated native overview, compact overview, Layout, Printers and Display artifacts were reviewed after container chrome landed. Native overview and settings remain coherent. The compact artifact exposed the weather/music collapse fixed above. Default five-card Bento/Focus and the custom layout, gallery, editor and drag-preview artifacts were then reviewed. Gallery/editor labels are now singular and clear, removals are red, and the drag ghost and destination marker are distinct. The short default cards exposed the remaining need for a compact content hierarchy rather than blanket scrolling.

The final named-container query was tested in isolated 246px-high cards: Clock’s date ends at y216 within its body ending at y249; the Weather content fits its 188px body without overlapping; Music’s transport ends at y247 within the body ending at y249, and every transport button remains 48 × 48px. Volume remains in the music scroll region. The final integrated artifacts generated at 12:16–12:17 confirm visible clock date, current weather and media transport in native Bento/Focus, and visible system volume as well in compact Overview. `artifacts/verification.json` reports no script errors. Short chat cards and narrow printer cards retain internal scrolling for additional content; no overlapping content was observed. After that review, root added the scoped short/wide printer row so both H2D/P1S statuses can appear together in default Bento; root owns the final rerun for that placement-only adjustment.

A source audit also identified focus loss when card tabs and settings navigation were rebuilt after selection. The renderer now retains card-tab nodes during selection and restores the selected settings button. An isolated keyboard check confirms Enter on Apps retains focus on Apps; Escape closes Settings and returns focus to Customize. The layout owner added focus restoration to the same labelled control, meaningful gallery item or Undo. Forced-colors emulation resolves the shared focus token to system Highlight.

Existing artifact screenshots reviewed before the new container layout: dashboard at 2560 × 720, widget settings, Spotify setup, printer settings, weather detail, printer controls, and music playlists. These established the specific changes above; they are not evidence of the final layout rendering.

## Content and tone standards

Use short action labels tied to a result: “Save printer”, “Change city”, “Stop print”. Keep availability and feedback factual: a sent command is not proof that the printer completed it; a saved forecast is not live weather; local Codex activity is not a connection to web chats. Preserve explanations for unavailable controls and failed saves, instead of relying on gray or red alone.

## Anti-patterns and migration notes

- Do not add another one-off radius, field edge or focus color to solve a local inconsistency; use the shared token first.
- Do not shrink settings labels or targets to fit all tabs; retain horizontal scrolling.
- Do not use blue primary styling for Stop print, remove a confirmation, or simulate printer success in the UI.
- Do not apply lowered opacity to an entire content group to indicate that one action is unavailable.
- Do not add decorative glass to status cards, replace actual weather with sample values, or remove the requested chat wave.
- The shared layer loads last. Its selectors deliberately avoid layout grid placement and the layout editor’s scoped geometry.

## Final QA and remaining limitations

- [x] Review integrated Overview artifacts at 2560 × 720 and 1600 × 450; root’s baseline layout checks cover 2048 × 576 and 900 × 700 as well.
- [x] Review native default five-card Bento/Focus and custom layout, gallery, editor and drag-preview artifacts; identify the short-card content issues.
- [x] Verify final short-card hierarchy in isolated 246px-high cards with no physical controls invoked.
- [x] Confirm final integrated native Bento/Focus and 1600 × 450 Overview screenshots after the short-card CSS query. Full zoom/size accessibility coverage remains separate.
- [x] Exercise all six settings panes for 48px targets and horizontal overflow; inspect narrow Apps and the last printer setup rows.
- [x] Review completed gallery/editor screenshots, including default selection, reordering, removal and the last editor rows.
- [x] Confirm Stop print has the semantic destructive class and that Cancel is initially focused in source.
- [ ] Confirm closed dialogs return focus to their launcher and Escape remains reliable in nested confirmations.
- [ ] Inspect reduced-motion, reduced-transparency, forced-colors and keyboard-only flows in the integrated build.
- [ ] Check 200% text/browser zoom and long content for clipping; compact fixed-height dashboard legibility is not yet certified.
- [ ] Conduct Windows Narrator and actual touchscreen checks. DOM labels and visible focus do not substitute for assistive-technology or physical-touch testing.

No Apple native-framework integration, Dynamic Type support, formal WCAG audit, or Apple approval is claimed. OS pickers, Spotify’s external sign-in pages, and printer firmware screens remain outside this CSS layer.
