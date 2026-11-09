# Changelog

## 0.16.0

- **A Home Screen like iOS.** Widgets are the only layout. Pages of widgets sit side by side: swipe and they follow your finger, or tap the dots at the bottom right.
- **Add widgets from a gallery.** Search, or pick a source (Clock, Weather, Music, 3D printers, PC, Agents, Controls, Timer, Apps), then swipe through live previews of each widget in each of its sizes and tap Add widget. It goes where there is room, or onto a new page.
- **Each widget has its own sizes**, as on iOS: Agent chats are Medium, Large or Tall; a City clock is Small; World clock is Small or Medium. Edit widget offers only those, plus the widget's options and its page.
- **Hold a widget** for Edit widget, Edit Home Screen, its settings or Remove. **Hold an empty spot** (or use the menu) to edit the Home Screen: widgets wiggle, – removes one, a tap edits it, hold to move it, and hold at the edge to carry it to the next page.
- **New widgets from iOS:** Clock digital, Clock I, II and III faces, City clocks (digital or analog, with the time difference), World clock, and Weather Details (rain chance, wind), Daily forecast and Sunrise and sunset.
- **Clock and weather are separate widgets**, with the sizes and layouts of iOS: Clock digital and three analog faces, City and World clock; Forecast (Small, Medium, Large), Details, Daily forecast and Sunrise and sunset, all over Edge Deck's living sky. A Time & weather widget becomes Clock digital plus Forecast.
- **Spotify like iOS:** Small and Medium show Recently Played (the song, DJ, Liked Songs and your latest playlists); Large and Tall are the full player with Canvas.
- The page goes full screen inside the full-screen window, so Edge's toolbar no longer drops down over the widgets when the mouse touches the top edge.
- **Smart Stack.** Several widgets in one place: swipe up or down to flip through them (dots show where you are). Drag a widget onto another in Edit Home Screen to stack them, or add the ready-made Smart Stack from the gallery. Smart Rotate turns the stack to a widget that needs you, such as a printer error or an agent waiting for approval. Edit Stack reorders, removes and picks the shown widget.
- Up to 40 widgets over six pages. Earlier layouts move to Widgets automatically, spread over pages so every widget fits.

## 0.15.0

- **Widgets, like iOS.** A new Widgets layout: an 8 × 2 grid where every card is Small (1 × 1), Medium (2 × 1), Large (2 × 2) or Tall (1 × 2), chosen with one tap in Edit layout. Each card has a design for each size instead of stretching one layout: Clock, Time & weather, Weather, Printers, Music, PC stats, Agent chats and Quick controls. Widgets that do not fit the page are listed so you can shrink or move them.
- **Four single-purpose widgets** for the gaps: **Gauge** (one CPU, GPU, memory, video-memory or temperature ring, with a history line and the busiest apps at larger sizes), **Switch** (one quick control such as Wi-Fi, Bluetooth, sound, microphone, dark mode or Night light, with its networks or devices at larger sizes), **Timer** (a countdown with presets that rings and makes the card glow when done, and survives a restart) and **Printer** (one printer at a glance: a progress ring, the full row, or the job details). Choose the reading, control or printer in the card's editor.
- The dashboard window is kept full screen on its display: if Windows or another app moves or resizes it, it is put back within 15 seconds (never while a game is in front).

## 0.14.0

- **Pages.** Group cards into pages: tabs at the bottom right (with + to add one), or swipe across the cards. Your current cards become the Home page.
- **Auto arrange.** A new layout that sizes every card for its content and, when space runs short, stacks cards that work at half height (printers then sit side by side).
- **No top bar.** Customize, Edit layout and Full screen live behind the Edge Deck button at the bottom left; cards get the room. **Up next** fills the clock column (agents that need you, prints and when they finish, the next weather change), and cards tint and glow when something needs you.
- **Settings in four tabs** (Layout, Apps, Connections, Display). Long-press a card to open its settings. Larger text on the dashboard; no scroll bars anywhere.
- **PC stats card.** CPU, GPU, memory and video memory, the busiest apps, uptime and an internet speed test, with a full-card game view. Optional CPU temperature through the signed PawnIO driver (Intel and AMD Ryzen; Turn on asks for administrator permission once).
- **Quick controls like Windows Quick Settings.** Wi-Fi, Bluetooth, sound and microphone tiles with detail views, dark mode, Night light, and Lock, Sleep, Restart and Shut down.
- **Printers.** Live camera previews inside the card (smooth video for the H2D); a simpler panel with pause, resume, stop, filament and camera; **Print again** for the last job, which checks the file and the loaded filaments before asking you to confirm (not yet tested on every printer).
- **Spotify.** DJ on Home and an Add Discover Weekly shortcut. The library and Home are kept between restarts, so updates no longer trigger Spotify's rate limit; empty replies from Spotify no longer show an error.
- **Weather.** Fog rolls across the sky like Apple Weather's, and low visibility brings mist or haze.

## 0.13.0

- **Notifications.** A Windows notification when a print finishes (with a picture of the model, the printer and how long it took) or fails, and when Claude Code or Codex waits for your approval. Clicking one opens the dashboard.
- While a game or other full-screen app is in front, notifications wait and appear once it closes; several become one summary.
- Turn print or approval notifications off in Customize → Display.

## 0.12.1

- Starting Edge Deck (for example after an update) no longer takes focus from a full-screen game: the dashboard is tucked out of the taskbar without being activated.

## 0.12.0

The first public release.

- **Updates from the tray.** Edge Deck checks GitHub for new releases every six hours. When one is out, the tray icon offers **Update to x.y.z** (and Customize → Display shows it too); one click downloads it, checks it against its published SHA-256 and reinstalls in place, keeping your settings.
- **Installer.** Double-click **Install Edge Deck.cmd**: per-user, no administrator rights, Start menu entries, an entry in Installed apps and an uninstaller.
- **Lives in the tray.** The dashboard has no taskbar button; its icon sits in the taskbar's hidden icons (^) with Open, Exit full screen, Check for updates and Quit.
- **New app icon**, also in the dashboard's top bar.
- **Music like Spotify's mobile app:** a full-screen player that slides into a mini player above Home, Search and Your Library; Home with recent shortcuts, Liked Songs and shelves; optional Canvas videos.
- **Printers:** the printer's own preview of the model being printed, progress like the printer's screen, a clear finished state that returns to idle after five minutes, and the loaded AMS spools in their colours. Printer names from your Bambu account (optional sign-in).
- **Weather:** 24 sky conditions, each for day, sunrise, sunset and night.
- **AI agents:** Codex, Claude Code and ChatGPT app chats with step lists, background tasks and plan usage.
- **Fixes:** Spotify no longer gets rate-limited by frequent library reloads, and long rate-limit waits are capped, so the player (progress slider, Canvas) stays available.
