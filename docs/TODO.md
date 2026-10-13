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

- [~] **Download queue + limits** (like Free Download Manager) — requested 2026-10-12:
  - [x] 2026-10-13 Max simultaneous downloads (Settings → Downloads, 1–10, default 4); extra ones
        wait in a queue and start automatically. "Start now" skips the queue.
  - [x] 2026-10-13 Priority per download (High / Normal / Low) — sets the queue order.
  - [ ] Move up/down within a priority; high priority also getting more connections.
  - [ ] Global speed limit (e.g. cap Bro's downloads at 2 MB/s so browsing stays fast) and
        optional per-download limit (token bucket in `SegmentedJob`; Chromium-engine items can
        only be paused/resumed, not throttled; WebTorrent has `throttleDownload`).
  - [x] 2026-10-13 Pause all / Resume all.  [ ] “Start queued downloads at a set time” (scheduler).

- [ ] **Torrents — follow-ups** (magnet + .torrent support done 2026-10-13):
  - [ ] Optional seeding (ratio / time limit) — today a torrent stops when it finishes.
  - [ ] Pick which files of a multi-file torrent to download.
  - [ ] Cancelling a *paused* torrent keeps its partial files (only a running one is deleted).
  - [ ] Real-world swarm not tested on this network (BitTorrent traffic seems blocked here: no
        peers for a public torrent); tested end to end with a local tracker + seeder.
  - [ ] Packaging: check `npm run pack` keeps `utp-native`'s prebuilt `.node` outside the asar.

- [ ] **Save for offline — follow-ups** (feature done 2026-10-13, see Done):
  - [ ] Pick which video when a page has several streams (today: yt-dlp's choice, else manifests
        in the order the player loaded them, then the biggest file).
  - [ ] Course lessons saved through the browser path still get the course's tab title (Udemy:
        "Course: … | Udemy"), so folders are "(2)", "(3)"… When yt-dlp picks the lesson, the save
        takes the lesson's own title (but its folder keeps the tab title). Read the lesson title
        from the page instead, and name the folder after it.
  - [ ] Browser-path DASH (separate .mpd video/audio) — today only yt-dlp handles DASH.
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
- [ ] Save for offline on a real Udemy lecture after the fix (needs the owner's sign-in; the
  failure was reproduced with a local "bot wall" fixture instead).
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

- [x] 2026-10-13 Chrome-style Settings and Library/Downloads pages (header search, side nav, cards,
  switches; downloads grouped by day with file-type tiles, priority menu, "New download" box for
  links and magnets). Toolbar: SVG icons; Downloads button always shown with a progress ring;
  Save-for-offline no longer greyed out on non-video pages (a dot marks a found video).

- [x] 2026-10-13 Library as a page in a tab, like Chrome: **Ctrl+J → bro://downloads**, **Ctrl+Shift+J →
  bro://offline** (one Library tab, reused; Bookmarks menu has both). Library tabs carry the bridge
  preload, so they can only show the Library: any other address swaps in a normal tab, extensions
  never see them, no history entries, and `bridge.ts` only exposes `window.bro` on dist/ui pages.
  E2E `library-tab-suite.mjs` 7/7.
- [x] 2026-10-13 Fixed: picking one lecture out of a course took forever ("Looking for the video…" for
  5+ min, queue blocked): the match filter opened all 534 lectures. Now one `--flat-playlist` listing
  finds the entry, then only that one is downloaded. Plus a watchdog: yt-dlp silent for 4 min is
  stopped and the next way in is tried.

- [x] 2026-10-13 Fixed: "Save video" on a Udemy lecture downloaded the whole course (534 lectures) —
  yt-dlp opens a lecture link as its course. A single save now stops yt-dlp as soon as it reports
  a playlist (`after_filter` print, before any video is written), retries with a match filter
  for the entry whose id is in the page address (lecture 45349009), else uses the stream the page
  plays; failed runs remove what they wrote; no playlist-level meta files. E2E 30/30.
  (The match filter was replaced the same day by a flat listing — see above.)

- [x] 2026-10-13 Fixed: Udemy save failed with "[udemy:course] assets … HTTP 403". The stream the page
  played was handed to yt-dlp, which mistook `udemy.com/assets/…m3u8` for a course page. Now:
  streams the page played are fetched **through the tab's own browser session** (`stream-grabber.ts`:
  HLS incl. AES-128, separate audio, byte ranges; plain files), yt-dlp only gets stream URLs with
  `--use-extractors generic`, retries as Chrome (`--impersonate chrome`) when refused, and failures
  are explained in plain words. Also: the master playlist is used (quality choice was ignored).
  E2E 29/29.

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
