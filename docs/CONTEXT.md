# Bro — working context

Everything a new session (human or AI) needs to pick up work on Bro without
re-discovering it. Design rationale and roadmap: [`../poc.md`](../poc.md).
Open work: [`TODO.md`](./TODO.md).

## What Bro is

A Chromium-based desktop browser on **Electron 44.7.0** (TypeScript, esbuild,
no UI framework) whose window is **hidden from screen share** (`setContentProtection`)
and can be **faded** (`setOpacity`). Windows 11 is the dev/target machine; macOS
is supported by the code but not built here.

## Architecture in one screen

- One `BrowserWindow` (`src/main/window.ts`) hosts `WebContentsView`s: the chrome
  bar (`src/ui/index.*`), the active tab, and Settings / Library overlays.
- `src/main/browser.ts` wires everything; `tabs.ts` owns tabs; `ipc.ts` maps every
  channel in `src/shared/ipc-contract.ts` (the single typed IPC contract).
- Shortcuts: registry in `src/shared/shortcuts.ts`; dispatch in `src/main/shortcuts.ts`
  (in-app via `before-input-event` on every view, system-wide via `globalShortcut`).
  The app menu only *displays* keys (`registerAccelerator: false`).
- Persistence: `src/main/store.ts` — debounced JSON files in `%APPDATA%\bro-browser\data`.
- Sessions (Electron): `defaultSession` for normal tabs, `bro-private` (in-memory)
  for private tabs. Ad blocking (`adblock.ts`) is attached to every session tabs use.
- Extensions: `electron-chrome-extensions` + `electron-chrome-web-store` on the
  default session (GPL-3.0). Private tabs are never registered with it.
- YouTube: `src/preload/youtube.ts`, a session frame preload, prunes ad data inside
  the page before YouTube reads it (Ghostery's scriptlets arrive too late). Tabs use
  `nodeIntegrationInSubFrames` (still sandboxed) so it also runs in embedded players.
- Profiles (`profiles.ts`): default profile = default session; others
  `persist:bro-profile-<id>`. `Browser.profileSession()` wires each session once
  (ad blocking, YouTube shield, downloads, extensions). Current profile = active tab's.
- Downloads (`downloads.ts`): segmented engine for range-capable http(s) files,
  Chromium's DownloadItem otherwise; state in `data/downloads.json` (private ones never).
- Right-click: `context-menu.ts`, wired from `TabManager.onContextMenu`.
- Save for offline (`offline.ts` + `video-tools.ts`): `session.webRequest.onResponseStarted`
  sniffs videos/HLS/DASH per tab (`TabState.hasVideo` lights the toolbar button); a save is a
  folder `<downloadDir>/Bro Offline/<title>/` with `page.mhtml` (`webContents.savePage`),
  the videos (yt-dlp, run as a child process), subtitles and a generated `index.html` player.
  State in `data/offline.json` (private-tab saves never). Tools live in `userData/tools`.

## Decisions worth knowing (and why)

- Tabs stay `sandbox: true`; only Bro's own UI views get the privileged preload.
- `TabManager` ignores the extension library's "select this tab" echo while it is
  creating a tab (`isCreating`) — otherwise restored/background tabs wake up and a
  restored tab's URL got overwritten (data loss).
- Ghostery registers process-wide `ipcMain.handle` channels per session; `AdBlock.enableIn`
  drops the old registration before attaching to another session.
- A tab whose webContents dies on its own is dropped on `destroyed` (prevents a
  main-process crash in the tab list).
- Private tabs: no history, never saved/exported, extensions off, wiped on last close.

- Offline saves try: the right-clicked video, **yt-dlp on the page URL** (it knows 1000s of
  sites), then the streams Bro sniffed — HLS and plain files through **the tab's own session**
  (`stream-grabber.ts`, Chromium's network stack: same cookies/UA/TLS, so bot walls and signed
  CDN links let it through), DASH through yt-dlp. yt-dlp gets the tab's cookies (temp Netscape
  file, deleted after) + UA + Referer, and is retried with `--impersonate chrome` when refused.
  One save runs at a time (slow links do better that way).
- Never hand yt-dlp a stream URL without `--use-extractors generic`: site extractors match by
  host, e.g. `udemy.com/assets/….m3u8` was treated as a Udemy course → 403.
- Browser-path HLS: picks the variant for the quality setting (+ its EXT-X-MEDIA audio), mirrors
  segments/keys/init into `.bro-stream-<hash>/` (kept between retries, so it resumes), then
  `ffmpeg -allowed_extensions ALL -protocol_whitelist file,crypto,data` joins them. AES-128 with
  KEYFORMAT identity is plain HLS; any other key method/format is DRM and refused. Live streams
  (no ENDLIST) are refused.
- yt-dlp needs a JS runtime for YouTube: Bro passes its **own Electron binary** with
  `ELECTRON_RUN_AS_NODE=1` (`--js-runtimes node:<execPath>`). Don't disable Electron's
  RunAsNode fuse, or YouTube saves lose formats.
- `onResponseStarted` is used because Ghostery owns `onBeforeRequest`/`onHeadersReceived`
  (Electron allows one listener per webRequest event per session).
- Subtitles are inlined into `index.html` as blob: URLs — Chromium refuses `<track>` files
  from file:// pages. MHTML pages run with scripts disabled (`executeJavaScript` never answers).
- ffmpeg is ffmpeg-static b6.1.1 (one gz binary, ~30 MB; hashes pinned in `video-tools.ts`);
  yt-dlp is always the latest release, checked against its SHA2-256SUMS. Asking yt-dlp for every
  English subtitle variant (`en.*`) gets HTTP 429 from YouTube — keep the explicit list.
- yt-dlp's catch-all extractors (`Generic`, `HTML5MediaEmbed`) title videos "<page> (1)", so
  only known sites rename a save to the video's own title.

## Environment quirks (this dev machine)

- Corporate TLS inspection (`NSN-INTRA`): fetch the Electron binary with
  `NODE_TLS_REJECT_UNAUTHORIZED=0 node node_modules/electron/install.js`.
  Runtime downloads (Chromium network stack) work normally.
- Very slow process start-up (security software): a bare Electron window takes ~8 s,
  Bro ~13 s plus ~30 s CPU to settle, a new tab 5–10 s. Compare against a bare
  Electron app before calling something a Bro regression.
- Packaging needs `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`
  (copy of any extracted numbered folder) because the archive's macOS symlinks
  need Developer Mode. See README → Packaging.
- Dev and packaged builds share the profile `%APPDATA%\bro-browser` (it has a uBlock
  extension installed). **Back up `data\*.json` before tests that change settings.**
- `Invoke-WebRequest` to localhost goes through the proxy — use `curl --noproxy '*'`
  or Node `fetch` with `NO_PROXY='*'`.

- On YouTube the main log shows harmless `UnhandledPromiseRejectionWarning: Script failed
  to execute` lines: Ghostery injects its (now redundant) YouTube scriptlets late via
  `executeJavaScript` without a catch, and YouTube rejects them. Not from Bro's code.

## How to test

End-to-end scripts live in [`../tests/e2e`](../tests/e2e) — see its README. They
drive the real app over the DevTools protocol (main process on `--inspect=9229`,
pages on `--remote-debugging-port=9333`). Key tricks:

- Evaluate in main with `includeCommandLineAPI: true` and grab `require('electron')`
  at the top level of the expression (not inside an async function).
- Send keys with `webContents.sendInputEvent` — CDP `Input.dispatchKeyEvent` does not
  reach `before-input-event`.
- Close tabs through Bro (`bro.closeTab` / `tab.close`), not `webContents.close()`.
- Native menus: patch `Menu.prototype.popup` in main to capture the menu, then call
  `item.click()`. Mouse input via `sendInputEvent` is dropped while the screen is locked.
- Downloads: `tests/e2e/fixtures/download-server.mjs` (ranges, throttle, flaky, bump).
  Point `downloadDir` at a temp folder during tests and reset `prefs.json` after.
- `capturePage()` on the window is blank while screen-share hiding is on; capture
  individual views instead (and it fails while the screen is locked). An offscreen
  `BrowserWindow` (`webPreferences.offscreen: true`) still renders while locked.
- Offline: `tests/e2e/fixtures/offline-server.mjs` + `offline-suite.mjs` (see its README).

## Last verified state (2026-10-12)

- `npm run typecheck` + `npm run build` clean; `npm run pack` → `release/win-unpacked`.
- Downloads 17/17 + crash-relaunch 3/3, profiles 17/17 + restart 4/4 + purge 2/2,
  right-click 11/11 (+1 real-click check not runnable while locked), YouTube embeds
  pruned. Regression: see the latest run noted in TODO/CONTEXT updates.
