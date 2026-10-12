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
- [ ] **Licensing** — `electron-chrome-extensions` is GPL-3.0 (matters if distributed).

## Not built

- [ ] **`chrome.webNavigation` for extensions** — missing in `electron-chrome-extensions`;
  uBlock (installed in the dev profile) logs errors because of it. Reinstalling
  the extension does not help. Could be shimmed from `webContents` navigation events.

## Never tested

- [ ] "Save … as" / "Ask where to save" dialogs (native dialogs can't be driven by the tests).
- [ ] A real mouse right-click (synthetic input is dropped while the screen is locked; every
  menu item was tested through the menu-building path instead).
- [ ] Downloads queue: no limit on simultaneous downloads yet (FDM has one) — consider.
- [ ] Export / Import (native file dialogs) and Clear cookies / Clear cache buttons.
- [ ] Fullscreen requested by a page (video ⛶ button) — tab view may need re-layout.
- [ ] YouTube shield on music.youtube.com and m.youtube.com (covered by the hostname match).

## Watch

- [ ] One unexplained native Electron crash (segfault) while closing a tab during
  testing on 2026-10-12; not reproduced in ~30 tries + a full rerun.
- [ ] YouTube changes its ad delivery every few months → `src/preload/youtube.ts`.

## Housekeeping

- [ ] ~16 leftover `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<number>` folders;
  only `winCodeSign-2.6.0` is needed.

## Done

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
