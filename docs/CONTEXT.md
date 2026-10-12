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
  individual views instead (and it fails while the screen is locked).

## Last verified state (2026-10-12)

- `npm run typecheck` + `npm run build` clean; `npm run pack` → `release/win-unpacked`.
- Downloads 17/17 + crash-relaunch 3/3, profiles 17/17 + restart 4/4 + purge 2/2,
  right-click 11/11 (+1 real-click check not runnable while locked), YouTube embeds
  pruned. Regression: see the latest run noted in TODO/CONTEXT updates.
