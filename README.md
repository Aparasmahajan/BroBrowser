# Bro

A fast, privacy-focused desktop browser built on Electron. Two signature
features are baked into the window itself:

- **Invisible to screen share / recording** — the window (and all tabs) is
  excluded from software screen capture on Windows *and* macOS.
- **Adjustable opacity** — fade the whole window from solid to a faint ghost.

It browses like Chrome/Brave because it *is* Chromium, blocks ads and trackers
out of the box, and **supports Chrome Web Store extensions**.

> Design rationale and the full roadmap live in [`poc.md`](./poc.md).

---

## Features

| Area | What you get |
|---|---|
| **Screen-share invisibility** | `setContentProtection` → `WDA_EXCLUDEFROMCAPTURE` (Windows) / `NSWindowSharingNone` (macOS). Default ON. |
| **Opacity** | Whole-window opacity, floored at 20% so you can't lose it. |
| **Overlay mode** | Click-through + always-on-top — a passive floating pane that lets clicks pass to the app beneath. |
| **Boss key** | One key hides Bro completely (no taskbar/dock entry) and brings it straight back. |
| **Tabs** | Real isolated Chromium tabs (`WebContentsView`): new/close/switch, reopen closed, duplicate, jump to tab 1–9, favicons, loading state. |
| **Omnibox** | URL or search; **site-search keywords** (`yt lofi`, `w Electron`, `gh electron`) and a choice of default engine — on the start page too. |
| **Private tabs** | Like Incognito: `Ctrl+Shift+N` or the button next to **+**. Private tabs share one in-memory storage area — cookies and site data are wiped when the last one closes. No history, never saved in sessions, links stay private, extensions off, ads still blocked. |
| **Profiles** | Separate browsers inside Bro (e.g. Work / Personal): each has its own sign-ins and cookies, history, bookmarks and extensions. Profile button in the toolbar; tabs carry their profile's colour; links stay in their profile. |
| **Downloads** | A download manager built in: big files come down over up to 16 parallel connections, every piece's progress is saved, so downloads survive pauses, network drops, crashes and restarts (and continue by themselves). Downloads list with Ctrl+J; pause/resume/cancel/retry/open/show in folder; choose folder, ask-where, connections in Settings. |
| **Save for offline** | Ctrl+S (or the button next to Downloads, which lights up when a page plays a video) saves the page *and* its video for watching without internet: a page snapshot (`page.mhtml`), the video(s) as MP4, English subtitles, and an `index.html` player with speed buttons, resume-where-you-stopped and a lesson list. Works on YouTube and 1000s of sites (via yt-dlp), plain video files and HLS/DASH streams; anything a browser can't play is converted (ffmpeg). Whole playlists/courses, quality 360p–1080p or audio only, one save at a time, pause/resume, auto-retry on network loss, continues after a restart. Library → Offline. DRM-protected video needs be saved. |
| **Right-click menu** | Open link in new / private tab / another profile, Save link/image/page as, Copy image / link, search the selection, spelling suggestions, Inspect, extension items. |
| **Sessions** | Reopens last time's tabs on launch (they load when clicked, so startup stays fast). Save all open tabs as a **named session** and reopen it later. |
| **Find & zoom** | Find in page with match count; Chrome's zoom steps with a badge that resets on click; full screen, print, view source, DevTools. |
| **Ad & tracker blocking** | Ghostery engine (EasyList, uBlock Origin filters, trackers), in normal and private tabs, cached to disk. Live block count + Retry in Settings. |
| **YouTube ad shield** | Also inside YouTube players embedded in other sites. Removes ad breaks from YouTube's player data before the player reads it, skips any ad that still slips through, hides feed/banner ads and the "ad blockers not allowed" wall. Follows the ad-blocking switch. |
| **Bookmarks & history** | Star in the address bar; history auto-recorded (2000 cap). **Library** overlay: Bookmarks · History · Sessions, with filter. |
| **Keyboard shortcuts** | Every shortcut is **rebindable** in Settings, groups switch on/off, a **master switch** cuts off chosen groups at once, and **your own shortcuts** open a site or search — in-app or system-wide. |
| **Chrome extensions** | Install from the **Chrome Web Store** (🧩 button → chromewebstore.google.com), toolbar action icons, installed extensions restored on launch. |
| **Your data** | Export/import one `.json` backup (bookmarks, history, sessions, shortcuts, search engines, startup choice); clear history, cookies, cache. |
| **Cross-platform** | One codebase for Windows 11 and macOS. |

---

## Keyboard shortcuts

All of these are defaults — change any of them in **Settings → Keyboard
shortcuts** (click **+**, press the keys). `Ctrl` is `Cmd` on macOS.

**BroBrowsing** — system-wide, so they work mid-meeting while another app is focused:

| Keys | Action |
|---|---|
| `Ctrl+Shift+H` | Toggle screen-share invisibility |
| `Ctrl+Shift+]` / `[` | Opacity up / down |
| `Ctrl+Shift+\` | Reset opacity to solid |
| `Ctrl+Shift+O` | Overlay mode (click-through + float) |
| `Ctrl+Alt+B` | Boss key: hide / show Bro |
| `Ctrl+Shift+S` | Open / close Settings |
| `` Ctrl+Shift+` `` | **Master switch** — cut off / restore the groups you pick (default: BroBrowsing) |

**In the app** (Chrome/Edge conventions):

| Keys | Action |
|---|---|
| `Ctrl+T` / `Ctrl+W` / `Ctrl+Shift+T` | New tab / close tab / reopen closed tab |
| `Ctrl+Shift+N` | New private tab |
| `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+1…8`, `Ctrl+9` | Next / previous / nth / last tab |
| `Alt+Shift+D` | Duplicate tab |
| `Alt+←` / `Alt+→`, `Ctrl+R` / `F5`, `Ctrl+Shift+R` | Back / forward, reload, hard reload |
| `Ctrl+L` / `Alt+D` / `F6`, `Alt+Home` | Address bar, start page |
| `Ctrl+F`, `F3` / `Shift+F3` | Find, next / previous match |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `F11`, `Ctrl+P`, `Ctrl+U`, `F12` | Full screen, print, view source, DevTools |
| `Ctrl+D`, `Ctrl+Y`, `Ctrl+H`, `Ctrl+J` | Bookmark page, Bookmarks & History, History, Downloads |
| `Ctrl+S` | Save page + video for offline |
| `Ctrl+Shift+D` | Save all tabs as a session |
| `Ctrl+,` | Settings |

---

## Getting started

Requires Node 20+.

```bash
npm install        # install deps
npm start          # build + launch
```

On a network that does TLS inspection (like the corporate network this was
built on), `npm install` can't verify the Electron download. It isn't blocked —
fetch the binary with:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node node_modules/electron/install.js
```

(the zip is SHA-checked by the installer), or point `NODE_EXTRA_CA_CERTS` at
your corporate root CA.

Other scripts:

```bash
npm run build      # bundle main + preload + UI with esbuild
npm run watch      # rebuild on change
npm run dev        # build + launch with logging
npm run typecheck  # tsc --noEmit (strict)
```

### Netflix & other DRM video (Widevine)

Bro runs on [castlabs' Electron build](https://github.com/castlabs/electron-releases), which
adds Google's Widevine CDM (downloaded on first launch). Its `electron.exe` only carries a
*development* VMP signature, and Netflix refuses that (titles fail with E100 / M7701-…). Sign it
for production with a free castlabs EVS account, once per machine:

```bash
npm run vmp -- signup   # create the EVS account (e-mail + password, interactive)
npm run vmp             # sign node_modules/electron/dist — redo after electron is reinstalled
npm run vmp -- verify   # "development only" = not signed yet
```

The script uses `py`/`python` when there is one, otherwise sets up a private Python in
`%LOCALAPPDATA%ro-devpython`. Packaging signs the app itself (`build/after-pack.cjs`);
`BRO_SKIP_VMP=1` packs without signing.

### Packaging

```bash
npm run pack       # unpacked app in release/ (fast, no installer)
npm run dist:win   # Windows NSIS installer + portable .exe
npm run dist:mac   # macOS .dmg + .zip (must run on a Mac; signing/notarization via env)
```

Config is in [`electron-builder.yml`](./electron-builder.yml). Packaging VMP-signs the app
(needs the EVS account above, or `BRO_SKIP_VMP=1`). macOS notarization
needs an Apple Developer account (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID` + flip `notarize`). Auto-update (`electron-updater`) reads the
`publish` config — point it at your real release host before shipping. Add app
icons at `build/icon.ico` / `build/icon.icns` and uncomment the `icon` lines.

**Windows without Developer Mode:** electron-builder's `winCodeSign` archive
contains macOS symlinks that a normal user can't create, so packaging fails with
*"Cannot create symbolic link : A required privilege is not held"*. The Windows
tools inside extract fine — copy any of the numbered folders in
`%LOCALAPPDATA%electron-builderCachewinCodeSign` to `winCodeSign-2.6.0`
next to them (or enable Developer Mode) and run the build again.

---

## Architecture

One native `BrowserWindow` hosts layered `WebContentsView`s: a top chrome bar
(tabs + toolbar + find bar), the active tab below it, and Settings/Library
overlays on top. Only the trusted chrome + overlay views get the privileged
preload; **tabs stay sandboxed** (untrusted web content never gets Node).

```
src/
├─ shared/
│  ├─ ipc-contract.ts       # typed IPC — one source of truth both sides import
│  ├─ shortcuts.ts          # shortcut registry: commands, groups, default keys
│  ├─ keys.ts               # accelerator parsing/matching/formatting
│  └─ search.ts             # default search engines + validation
├─ main/                    # Node / main process
│  ├─ index.ts              # app lifecycle, single-instance lock
│  ├─ window.ts             # the window + content protection, opacity, boss key
│  ├─ browser.ts            # wires views, tabs, overlays, services, find, sessions
│  ├─ tabs.ts               # TabManager — WebContentsView tabs, URL resolution, restore
│  ├─ shortcuts.ts          # ShortcutManager — in-app + global dispatch, rebinding
│  ├─ commands.ts           # what each shortcut does
│  ├─ sessions.ts · search.ts · data.ts   # sessions, search engines, backup
│  ├─ profiles.ts           # profiles: one persistent session each
│  ├─ downloads.ts          # download manager (segmented, resumable) + Chromium fallback
│  ├─ offline.ts            # "Save for offline": video sniffing, save queue, offline player page
│  ├─ video-tools.ts        # fetches + runs yt-dlp and ffmpeg (userData/tools)
│  ├─ context-menu.ts       # right-click menus
│  ├─ adblock.ts            # Ghostery blocker (proxy-aware net.fetch, cached)
│  ├─ library.ts            # bookmarks + history
│  ├─ store.ts              # tiny debounced JSON persistence
│  ├─ extensions.ts         # Chrome extensions + Web Store
│  ├─ updater.ts            # electron-updater (packaged builds only)
│  └─ ipc.ts · menu.ts
├─ preload/
│  ├─ bridge.ts             # window.bro (sandboxed overlays)
│  ├─ chrome.ts             # bridge + extension toolbar injection (chrome view)
│  └─ youtube.ts            # YouTube ad shield (session preload, all frames)
└─ ui/                      # renderer pages (plain TS + CSS)
   ├─ index.{html,ts}       # tab strip + toolbar + find bar
   ├─ start.html            # new-tab start page (self-navigating)
   ├─ settings.{html,ts}    # privacy, appearance, startup, search, shortcuts, data
   ├─ library.{html,ts}     # bookmarks + history + sessions
   └─ styles.css
```

---

## Caveats & notes

- **Screen-share invisibility is software-only.** It hides from Teams, Meet,
  Zoom, OBS and screen recorders — **not** from a phone camera or HDMI capture
  card. macOS behavior can vary by OS version; verify per release. Only record or
  share meetings where you have consent.
- **System-wide shortcuts can collide with other apps.** If another app already
  owns a combo, Settings marks it red — pick another key, or use the master
  switch to hand a group back while you're in a meeting.
- **Ad blocking needs one online fetch** to download and cache the filter lists.
  On a proxy that blocks the list CDNs, Settings shows an error + a Retry button.
- **YouTube blocking is an arms race.** YouTube changes how it delivers ads; the
  shield (`src/preload/youtube.ts`) may need updating when it does.
- **Backups don't include cookies or sign-ins** — those stay in Chromium's own
  store on this machine.
- **Save for offline needs ~50 MB of tools once** (yt-dlp + ffmpeg, fetched into
  `%APPDATA%\bro-browser\tools` on the first video save, or from Settings → Downloads).
  When a site stops working, Settings → Downloads → *Update* gets the newest yt-dlp.
  DRM-protected video (Netflix-style, some paid course apps) can't be saved — Bro says so.
  Only save what you're allowed to keep (the site's terms apply).
- **Licensing:** `electron-chrome-extensions` is distributed under **GPL-3.0**
  (the license Bro passes to it). Factor this into any distribution.

---

## Status

Phases 0–4 are built, plus the power-user layer (shortcuts editor, sessions,
search keywords, find, boss key, backup), **private tabs**, **profiles**, a resumable
**download manager** and the **right-click menu**. Verified with typecheck + build + an
end-to-end run over the DevTools protocol, and a Windows package build. Still
open: app icons,
a real auto-update host, and Mac signing. See
[`poc.md` §7a](./poc.md#7a-implementation-status-as-of-2026-10-12).
"# BroBrowser" 
