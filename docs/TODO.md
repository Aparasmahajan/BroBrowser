# Bro — to-do

Status key: `[ ]` open · `[~]` in progress · `[x]` done (with date). Keep this file
current; the reasoning behind items lives in [CONTEXT.md](./CONTEXT.md).

## In progress

_Nothing right now._

## Needs a decision or input from the owner

- [ ] **Version control** — folder is not a git repo yet (offered `git init`).
- [ ] **App icons** — need a ≥256×256 image → `build/icon.ico` / `build/icon.icns`.
- [ ] **Auto-update host** — `publish.url` in `electron-builder.yml` is a placeholder.
- [ ] **Mac build + signing** — needs a Mac + Apple Developer account.
- [ ] **Licensing** — `electron-chrome-extensions` is GPL-3.0 (matters if distributed). The
  ffmpeg build Bro downloads at runtime is GPL too (fetched by the user, not shipped in Bro).

## Not built

- [ ] **`chrome.webNavigation` for extensions** — missing in `electron-chrome-extensions`;
  uBlock (installed in the dev profile) logs errors because of it. Reinstalling
  the extension does not help. Could be shimmed from `webContents` navigation events.

- [ ] **Download queue + limits** (like Free Download Manager) — requested 2026-10-12:
  - [ ] Max simultaneous downloads (e.g. 3); extra ones wait in a queue and start automatically.
  - [ ] Priority per download (High / Normal / Low) + move up/down in the queue; high
        priority gets connections first.
  - [ ] Global speed limit (e.g. cap Bro's downloads at 2 MB/s so browsing stays fast) and
        optional per-download limit.
  - [ ] Pause all / Resume all; “start queued downloads at a set time” (scheduler).
  - [ ] Where: `src/main/downloads.ts` (queue + token-bucket throttle in `SegmentedJob`;
        Chromium-engine items can only be paused/resumed, not throttled), Downloads view
        controls, Settings → Downloads.

- [ ] **Save for offline — follow-ups** (feature done 2026-10-13, see Done):
  - [ ] Pick which video when a page has several streams (today: yt-dlp's choice, else manifests
        first, then the biggest file).
  - [ ] Show "Save for offline" progress in the Downloads view too (today: Library → Offline).
  - [ ] Optional: bundle yt-dlp + ffmpeg into the installer (`extraResources`) for installs with
        no internet at all; `video-tools.ts` would look there first.

## Never tested

- [ ] "Save … as" / "Ask where to save" dialogs (native dialogs can't be driven by the tests).
- [ ] A real mouse right-click (synthetic input is dropped while the screen is locked; every
  menu item was tested through the menu-building path instead).
- [ ] Export / Import (native file dialogs) and Clear cookies / Clear cache buttons.
- [ ] Fullscreen requested by a page (video ⛶ button) — tab view may need re-layout.
- [ ] YouTube shield on music.youtube.com and m.youtube.com (covered by the hostname match).
- [ ] Save for offline: a real playlist download end to end (only the file naming was checked with
  a dry run), private-tab saves, the macOS builds of yt-dlp/ffmpeg, and losing the network
  mid-save (the retry path is coded; pause/resume and restart-resume were exercised).

## Watch

- [ ] One unexplained native Electron crash (segfault) while closing a tab during
  testing on 2026-10-12; not reproduced in ~30 tries + a full rerun.
- [ ] YouTube changes its ad delivery every few months → `src/preload/youtube.ts`.

## Housekeeping

- [ ] ~16 leftover `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<number>` folders;
  only `winCodeSign-2.6.0` is needed.

## Done

- [x] 2026-10-13 **Save for offline** (Ctrl+S / toolbar button / right-click): page snapshot (MHTML) +
  video(s) as MP4 + English subtitles + `index.html` offline player (speed, resume, lesson list);
  yt-dlp + ffmpeg fetched once (~50 MB, checksum-verified); any format converted to something
  Chromium plays; playlists/courses; quality 360p–1080p / audio only; queue, pause/resume,
  auto-retry, resumes after restart; Library → Offline; Settings → Downloads. E2E 22/22 + restart.

- [x] 2026-10-12 Right-click menu (links, images, media, selection search, editing, page, extensions, Inspect).
- [x] 2026-10-12 Download manager: segmented multi-connection, resumable across pause / network drop /
  crash / restart, auto-retry, Chromium fallback, Downloads view (Ctrl/Cmd+J), Settings.
- [x] 2026-10-12 Profiles: own session, history, bookmarks, extensions; switcher; coloured tabs.
- [x] 2026-10-12 YouTube ad shield inside embedded players (iframes).
- [x] 2026-10-12 Start page: Wikipedia shortcut removed.
- [x] 2026-10-12 Fixed: build broken by half-wired shortcuts/sessions/search work.
- [x] 2026-10-12 Shortcut editor, master switch, custom shortcuts, boss key, find, zoom,
  sessions + restore, search keywords, backup import/export, clear data.
- [x] 2026-10-12 Fixed: session restore overwrote saved tabs; background tabs woke up.
- [x] 2026-10-12 Private tabs (in-memory session, wiped on last close).
- [x] 2026-10-12 YouTube ad shield (youtube.com).
- [x] 2026-10-12 Fixed: main-process crash when a tab's page dies on its own.
