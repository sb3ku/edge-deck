# Changelog

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
