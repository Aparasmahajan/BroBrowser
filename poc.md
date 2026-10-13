# Project "Bro" — Privacy Browser PoC

A proof-of-concept plan for a fast, Chrome-class browser with two signature
features baked into the window layer itself:

1. **Invisible to screen share / screen recording** — the window (and all web
   content inside it) is excluded from software capture on Windows *and* macOS.
2. **Adjustable opacity** — a global hotkey / slider fades the whole window from
   solid down to a faint ghost, so it can sit over other work.

It should browse like Chrome/Brave (same engine, same speed, extensions,
ad-blocking) and run **flawlessly on both Windows 11 and macOS**.

> Lineage: this extends the proven stack in
> `C:\Users\parmahaj\Documents\New folder\AI-App` (the "StudyOverlay / MWA"
> overlay). That app already ships `setContentProtection(true)`,
> `setOpacity()`, click-through, and global hotkeys on Electron — "Bro" promotes
> that overlay into a real multi-tab browser.

---

## 0. The one decision that shapes everything: how do we get Chromium?

There are three ways to put a Chromium engine behind our own UI. This is the
single most important architectural choice.

| Option | What it is | Engine parity vs Chrome | Effort | Can we control the native window (invisibility + opacity)? |
|---|---|---|---|---|
| **A. Electron** (recommended) | Chromium + Node packaged together; we write the chrome (tabs, omnibox) in HTML/JS | Same Blink/V8 as Chrome, ~1–3 versions behind stable | **Low** (weeks) | **Yes** — full access to `BrowserWindow` native flags |
| **B. Fork Brave / Chromium** | Clone the actual Chromium source, patch C++, compile | Exact | **Very high** (months, 100+ GB build, a build farm) | Yes, but you're writing C++ for every platform |
| **C. CEF / WebView2 / WKWebView** | Embed an OS web control in a native (Qt/Swift/C++) app | Good, but per-OS engines diverge | Medium–High | Yes, but you maintain two native apps |

### Recommendation: **Option A — Electron**, for the PoC and v1.

Reasoning:

- **It already works.** AI-App proves every hard native trick (capture
  exclusion, opacity, always-on-top, click-through) works on Electron today.
- **One codebase, two OSes.** Option A gives Windows + macOS from a single JS
  codebase. Option B/C means maintaining native code twice.
- **Chrome-grade speed is inherent** — Electron *is* Chromium's Blink + V8. A
  tab in Electron renders the same as a tab in Chrome. "Faster than Chrome" then
  comes from what we *remove* (ad/tracker blocking, fewer background services),
  not from a different engine.
- **Extensions**: with `electron-chrome-extensions` + `electron-chrome-web-store`
  on top of Electron, you get the `chrome.*` APIs *and* real Chrome Web Store
  installs — not just unpacked local extensions.

Option B (fork Brave) is the "even better than Brave" dream, but it's a
different project in scale — a multi-month C++ effort with a dedicated build
pipeline. **Keep it as a v3 north star, not the PoC.** This document builds
Option A and notes where a future fork would differ.

---

## 1. Tech stack

The table below is the *original plan*. A few choices changed during build for
pragmatism — the **"As built"** column records what actually shipped; see
[§7a Implementation status](#7a-implementation-status-as-of-2026-10-12) for why.

| Layer | Planned choice | As built |
|---|---|---|
| **Runtime / engine** | Electron 32+ (Chromium + V8 + Node) | **Electron 44.7.0** |
| **Tab engine** | `WebContentsView` (modern multi-view API) | Same — each tab an isolated Chromium view |
| **Browser chrome (UI)** | TypeScript + Vite + React | **Plain TypeScript + esbuild** (no framework; lean, fast, fewer moving parts) |
| **Styling** | Tailwind or CSS modules | **Plain CSS** with light/dark tokens |
| **Ad / tracker blocking** | `@ghostery/adblocker-electron` (EasyList + uBO) | Same, downloaded via proxy-aware `net.fetch`, cached to disk |
| **Extensions** | `session.loadExtension()` + `electron-chrome-extensions` | **`electron-chrome-extensions` 4.9 + `electron-chrome-web-store` 0.13** — full Chrome Web Store installs |
| **Storage** | `electron-store` + SQLite | **Tiny debounced JSON store** (no native deps) for settings/bookmarks/history |
| **Secrets** | Electron `safeStorage` (keychain / DPAPI) | Not needed yet (no API keys in Bro) |
| **Build / packaging** | `electron-builder` | **esbuild** for code + `electron-builder` (Win NSIS/portable, mac dmg/zip) |
| **Auto-update** | `electron-updater` | Same (packaged builds only; feed URL still a placeholder) |
| **Language** | TypeScript end-to-end | Same — typed IPC contract shared by both sides |

### Process model

```
┌──────────────── MAIN process (Node) ──────────────────────────┐
│ BrowserWindow (frameless, transparent, content-protected)      │
│  ├─ WebContentsView #0  → the Chrome UI (tab strip, omnibox)   │
│  ├─ WebContentsView #1  → tab 1  (a real web page)             │
│  ├─ WebContentsView #2  → tab 2                                 │
│  └─ ...                                                         │
│ Window flags: setContentProtection, setOpacity, alwaysOnTop    │
│ globalShortcut hotkeys  →  IPC → UI view                       │
│ Ad-block engine attached to session (intercepts all requests)  │
│ SQLite (history/bookmarks) · safeStorage · session partitions  │
└───────────────▲────────────────────────────┬──────────────────┘
                │ contextBridge (preload.ts)  │ IPC
┌───────────────┴──── UI renderer (React) ────┴──────────────────┐
│ Tab strip · omnibox (search/URL) · settings · opacity slider   │
│ Sends "navigate / newtab / close / set-opacity" → main         │
└────────────────────────────────────────────────────────────────┘
```

Key point: **tabs are sibling `WebContentsView`s, not `<iframe>`s or
`<webview>` tags.** Each is a fully isolated Chromium process — same isolation
model as Chrome tabs, which is what keeps it fast and crash-resilient. The UI is
just another view layered on top, so the window stays one native `BrowserWindow`
and the capture-exclusion/opacity flags cover everything inside it.

---

## 2. Signature feature #1 — invisible to screen share

This is an **OS window attribute**, not a trick we invent. Electron exposes it
as one call; the OS enforces it against the software capture path.

```ts
win.setContentProtection(true);
```

### What that maps to under the hood

| OS | Native mechanism | Effect |
|---|---|---|
| **Windows 10 2004+ / 11** | `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` | Window renders normally on the physical display but is **omitted from the capture buffer** — appears as a hole/blank to the capturer |
| **macOS** | `NSWindow.sharingType = .none` (`NSWindowSharingNone`) | Window is excluded from screen-sharing and most screen-recording APIs |

Both are reached through the single `setContentProtection(true)` call — Electron
picks the right native API per platform. AI-App already relies on this on
Windows against Teams, Meet, Zoom, and OBS.

### Cross-platform reality check (be honest about this)

- **Windows**: Strong. `WDA_EXCLUDEFROMCAPTURE` is the modern flag and hides
  from DWM-based capture (what every meeting app and OBS use). Older
  `WDA_MONITOR` would show black; we want `EXCLUDEFROMCAPTURE`, which Electron
  uses on current builds.
- **macOS**: Good, with caveats. `NSWindowSharingNone` is respected by the
  standard capture paths. Newer `ScreenCaptureKit`-based tools and OS-level
  screenshot (`Cmd+Shift+5`) behavior can differ by macOS version, so this must
  be **tested per macOS release** (Sonoma, Sequoia, etc.) as part of CI.
- **Universal limit — state this in the UI**: this hides from *software*
  capture only. It does **not** hide from a phone camera pointed at the screen,
  an HDMI capture card, or hardware KVM capture. The pixels are still on the
  glass.

### UX

- Default **ON**, with a clear status pill in the toolbar ("Hidden from
  capture ●").
- Toggle hotkey (e.g. `Ctrl/Cmd+Shift+H`) and a settings switch.
- A one-click **"Test capture"** helper: open the OS screen-recorder or a
  self-preview so the user can verify before relying on it — mirrors AI-App's
  "verify invisibility" guidance.

### Ethical / legal guardrail (ship this, don't hide it)

Carry forward AI-App's legal note. Capturing or recording *other people* without
consent is unlawful in many jurisdictions (GDPR, US all-party-consent states).
This feature is for the user's own privacy over their own screen (e.g. keeping a
password manager, personal notes, or reference material out of a shared feed) —
present it that way, and surface the consent reminder in-product.

---

## 3. Signature feature #2 — opacity

Also a native window property — the whole window (UI + all tabs) fades together.

```ts
win.setOpacity(value); // 0.0 (invisible) … 1.0 (solid)
```

Design:

- Clamp to a usable floor (AI-App clamps to `0.2`) so the user can never fade it
  to fully gone and lose it.
- **Hotkeys**: `Ctrl/Cmd+Shift+]` = more opaque, `Ctrl/Cmd+Shift+[` = more
  transparent (AI-App's exact scheme), plus a toolbar slider.
- Persist last opacity in settings.
- **macOS note**: `setOpacity` works; transparent/vibrancy windows behave
  slightly differently than Windows, so test the frameless + transparent combo
  on both.
- Pair with **click-through** (`setIgnoreMouseEvents(true, { forward: true })`)
  as an optional mode, so at low opacity the browser can act like a true overlay
  and let clicks pass to the app beneath — AI-App already implements the cursor
  poll that toggles this around interactive zones.

---

## 4. "Browse like Chrome/Brave, even better and faster"

### Parity (it's Chromium, so most is free)

- Full modern web platform, DevTools (`openDevTools`), same JS/CSS/WASM support.
- Multi-tab, back/forward, history, bookmarks, downloads, find-in-page, zoom,
  per-tab mute — all wired via `WebContentsView` + `webContents` APIs.
- **Extensions**: load uBlock Origin, password managers, etc. via
  `loadExtension` / `electron-chrome-extensions`.
- Profiles / containers: `session.fromPartition('persist:profileX')` gives
  isolated cookie/storage jars (Brave-style containers, Firefox-style
  multi-account).

### Where "faster / better than Chrome" actually comes from

Not a faster engine (it's the same Blink) — it comes from **doing less and
blocking more**:

1. **Native ad + tracker blocking** at the request layer (`@ghostery/adblocker`)
   — fewer bytes, fewer scripts, fewer connections → pages genuinely load
   faster and lighter than vanilla Chrome. This is exactly Brave's thesis.
2. **No telemetry / no background Google services** that stock Chrome runs.
3. **Aggressive tab sleeping** — `webContents` of background tabs get throttled
   / frozen (`setBackgroundThrottling`, discard idle views) to cut RAM/CPU.
4. **Preconnect / prefetch** the omnibox's top hit on keystroke.
5. **HTTPS-first**, fingerprint resistance, and a strict default CSP for the
   browser chrome itself.
6. **Lean chrome UI** — the toolbar is a small React app, not a second heavy
   browser.

Honest caveat: Electron carries its own Chromium copy (~150–200 MB installed) vs
a shared system engine, and startup is a touch heavier than a hand-tuned native
browser. Runtime *browsing* speed, though, is Chromium-native.

---

## 5. Cross-platform: making it "flawless" on Windows **and** macOS

| Concern | Windows | macOS | Plan |
|---|---|---|---|
| Capture exclusion | `WDA_EXCLUDEFROMCAPTURE` | `NSWindowSharingNone` | Single `setContentProtection(true)`; **CI test on each OS/version** |
| Frameless + transparent window | Solid support | Needs care with vibrancy/traffic-light buttons | Custom titlebar; on mac use `titleBarStyle: 'hiddenInset'` for native stoplights |
| Window controls | Custom min/max/close in React | Keep native traffic lights or draw custom | Per-OS titlebar component |
| Global hotkeys | `globalShortcut` | `globalShortcut` (needs Accessibility permission for some) | Request permission on first run on mac |
| Code signing | Authenticode (EV cert ideal) | Apple Developer ID + **notarization** (`electron-notarize`) | Build pipeline per OS; unsigned mac apps are gatekept |
| Packaging | NSIS installer + portable `.exe` | `.dmg` + `.zip` (for auto-update) | `electron-builder` targets both |
| Auto-update | `electron-updater` (NSIS) | `electron-updater` (needs signed zip) | Same lib, per-OS artifacts |
| Keychain for secrets | DPAPI via `safeStorage` | Keychain via `safeStorage` | Already handled the same way in AI-App |

Build matrix: GitHub Actions with a **`windows-latest`** runner and a
**`macos-latest`** runner (macOS build/notarize must run on a Mac). electron-
builder produces both from the one repo — AI-App already has the Windows half of
this (`npm run build` / `build:portable`).

---

## 6. Proposed repo structure

```
bro/
├─ package.json              # electron, electron-builder, vite, ts
├─ electron-builder.yml      # win + mac targets, signing, notarize
├─ tsconfig.json
├─ src/
│  ├─ main/                  # MAIN process (Node)
│  │  ├─ index.ts            # app lifecycle, single-instance lock
│  │  ├─ window.ts           # BrowserWindow: frameless, transparent,
│  │  │                      #   setContentProtection, setOpacity
│  │  ├─ tabs.ts             # WebContentsView create/switch/close/layout
│  │  ├─ shortcuts.ts        # globalShortcut (hide, opacity ±, click-through)
│  │  ├─ adblock.ts          # @ghostery/adblocker, attach to session
│  │  ├─ extensions.ts       # loadExtension / electron-chrome-extensions
│  │  ├─ storage.ts          # SQLite history/bookmarks, electron-store
│  │  ├─ secrets.ts          # safeStorage wrappers
│  │  └─ ipc.ts              # typed IPC handlers
│  ├─ preload/
│  │  └─ bridge.ts           # contextBridge → window.bro (typed, no nodeInt.)
│  ├─ ui/                    # UI renderer (React/Vite)
│  │  ├─ App.tsx
│  │  ├─ TabStrip.tsx
│  │  ├─ Omnibox.tsx         # URL + search, suggestions, preconnect
│  │  ├─ Toolbar.tsx         # opacity slider, capture-hidden pill
│  │  ├─ Settings.tsx
│  │  └─ TitleBar.{win,mac}.tsx
│  └─ shared/
│     └─ ipc-contract.ts     # shared TS types for every IPC channel
├─ build/                    # icons (win .ico, mac .icns)
└─ docs/
   └─ poc.md                 # this file
```

---

## 7. Milestones / roadmap

**Phase 0 — Spike (days).** New Electron + TS + Vite skeleton. One
`BrowserWindow`, frameless + transparent. Prove `setContentProtection(true)` and
`setOpacity()` on **both** Windows and a Mac. ✅ gate: window invisible in a
self screen-share on each OS; opacity hotkeys work.

**Phase 1 — A real browser (1–2 weeks).** `WebContentsView` tabs: new tab,
close, switch, omnibox navigation + search, back/forward/reload, loading state,
favicons, titles. Custom titlebar per OS.

**Phase 2 — Fast & private (1–2 weeks).** Ghostery adblock on the session;
HTTPS-first; background-tab throttling; history/bookmarks in SQLite; downloads;
find-in-page.

**Phase 3 — Power features (2–3 weeks).** Extensions (uBlock Origin), profiles/
containers via session partitions, settings UI, click-through overlay mode,
per-tab opacity-aware behavior.

**Phase 4 — Ship (1–2 weeks).** electron-builder for Win (NSIS + portable) and
mac (dmg + zip), code signing + notarization, `electron-updater`, crash
reporting, first-run onboarding (incl. capture-exclusion + consent notice).

**Phase 5 — (north star, optional).** Evaluate forking Brave/Chromium for
deeper native integration if Electron's limits ever bite (e.g. need engine-level
patches). Treat as a separate, much larger project.

---

## 7a. Implementation status (as of 2026-10-12)

Built and verified (typecheck + build + boot, no crashes):

- **Phase 0 ✅** — frameless window, `setContentProtection` (screen-share
  invisibility), `setOpacity`, global hotkeys.
- **Phase 1 ✅** — real browser: `WebContentsView` tabs, omnibox (URL+search),
  back/forward/reload, start page, custom titlebar. Settings moved to its own
  overlay page (`Ctrl/Cmd+Shift+S`).
- **Phase 2 ✅** — ad/tracker blocking (`@ghostery/adblocker-electron`, via
  proxy-aware `net.fetch`), bookmarks, history, Library overlay, JSON
  persistence. Settings shows live block count + load errors + Retry.
- **Phase 3 ✅** — Chrome extension support incl. **Chrome Web Store installs**
  (`electron-chrome-extensions` + `electron-chrome-web-store`), `<browser-action-list>`
  toolbar, a Web Store button.
- **Phase 4 (mostly) ✅** — **overlay mode** (click-through + always-on-top,
  `Ctrl/Cmd+Shift+O`), **packaging** (`electron-builder.yml` for Win NSIS/portable
  + mac dmg/zip, mac entitlements, asarUnpack for the runtime-path packages),
  **auto-update** (`electron-updater`, packaged-only). A Windows `--dir` package
  build succeeds locally. **Profiles/containers deferred** — see below.
- **Power-user layer ✅ (2026-10-12)** — every shortcut is in one registry
  (`src/shared/shortcuts.ts`) and **rebindable in Settings** (record a key,
  conflicts move the key, per-group on/off, a **master switch** that cuts off
  chosen groups, **custom shortcuts** that open a site or keyword search,
  in-app or system-wide); **boss key** (`Ctrl/Cmd+Alt+B`); **find in page**;
  zoom with a badge; reopen closed tab / duplicate / tab 1–9; full screen,
  print, view source, devtools; **search engines + omnibox keywords**
  (`yt lofi`), also on the start page; **session restore** on launch (tabs
  sleep until clicked) + **named saved sessions** (Library → Sessions);
  **backup export/import** and clear cookies/cache. Verified end-to-end over
  CDP (42/43 checks; the miss was a slow-network timeout on a check that passed
  in an earlier run).
- **Profiles ✅ (2026-10-12)** — `src/main/profiles.ts`. Default profile = default
  session (existing data untouched); others = `persist:bro-profile-<id>`. Per-profile
  history/bookmarks files, extension system (`Extensions.ensure`), web-store folder.
  Current profile follows the active tab. Removal wipes the session and deletes the
  partition folder at next launch. 17/17 + restart checks.
- **Download manager ✅ (2026-10-12)** — `src/main/downloads.ts`. Range-capable http(s)
  downloads are taken over from Chromium after a `bytes=0-0` probe: N parallel
  segments (work stealing), positional writes into `<file>.brodownload`, per-segment
  progress persisted, per-segment backoff retries, stall detection, ETag/Last-Modified/
  size check before resuming (changed file → start over), auto-resume after a crash.
  Everything else stays on Chromium's DownloadItem (pause/resume, auto-resume on
  interruption). 17/17 + crash-relaunch checks against a local test server.
- **Right-click menu ✅ (2026-10-12)** — `src/main/context-menu.ts` (own builder;
  the bundled `electron-chrome-context-menu` lacks save/copy-image/search).
- **YouTube ad shield ✅ (2026-10-12)** — `src/preload/youtube.ts`, a session frame
  preload registered per session while blocking is on. It installs json-prune
  style hooks (`ytInitialPlayerResponse` accessor, `JSON.parse`, `Response.json`
  → drop `adPlacements`/`adSlots`/`playerAds`) into the page world with the
  synchronous `contextBridge.executeInMainWorld`, plus a skipper and CSS. Measured
  on 3 top music videos: before, the player sat in ad mode 10/10 samples on all
  three; after, 0 ad samples and the real video plays — also after in-app
  navigation and in private tabs. With blocking off, ads play (shield off).
- **Private tabs ✅ (2026-10-12)** — `Ctrl/Cmd+Shift+N` or the button by **+**.
  All private tabs share one in-memory partition (`bro-private`, no `persist:`),
  wiped (`clearStorageData` + cache + auth cache) when the last one closes. No
  history; excluded from autosave, saved sessions and export; `window.open`,
  duplicate and reopen stay private (reopen list purged on wipe); extensions are
  never told about them; Ghostery attached to both sessions. Verified over CDP
  (23/23, incl. an ad script that loads with blocking off and is blocked with
  it on, inside a private tab).

### Key engineering constraints discovered

- **The build network does TLS inspection** (`NSN-INTRA`) with a root CA that
  Node doesn't trust, so `npm install` can't fetch the Electron binary. It isn't
  blocked: run `NODE_TLS_REJECT_UNAUTHORIZED=0 node node_modules/electron/install.js`
  (the zip is SHA-checked) or set `NODE_EXTRA_CA_CERTS` to the corp root CA.
  Runtime downloads (adblock lists via `net.fetch`, Web Store) use Chromium's
  network stack + the Windows cert store and just work.
- The extension libraries need **Electron ≥ 35** (`session.registerPreloadScript`);
  on the old 32.3.3 pin both adblock and Web Store installs crashed.
- `electron-chrome-extensions` marks every tab it's told about as active and
  asks the app to select it. `TabManager` ignores that echo while it's creating
  a tab (`isCreating`) — otherwise restored/background tabs all wake up, and a
  restored tab's URL got overwritten with the start page (which then autosaved
  over the user's last session).
- All shortcuts go through `before-input-event` on every view (in-app) or
  `globalShortcut` (system-wide); the app menu only *displays* them
  (`registerAccelerator: false`) so a rebound key can't fire twice.
- **Packaging on Windows needs a seeded `winCodeSign-2.6.0` cache folder** (or
  Developer Mode): its archive has macOS symlinks a normal user can't create.
  The Oct 10 package build hit this too; see README → Packaging.
- **uBlock (MV3) logs errors** — `electron-chrome-extensions` doesn't implement
  `chrome.webNavigation`, so parts of extensions that use it don't work.
- **Ghostery's scriptlets are too late for YouTube**: its preload asks main over
  async IPC, main then `executeJavaScript`s the scriptlets — after YouTube has
  read its player data. Hence the dedicated YouTube shield above.
- **A tab's webContents can die on its own** (page `window.close()`, crash, or
  closed from outside). `TabManager` drops the tab on `destroyed`; otherwise the
  next tab list read `undefined.isDestroyed` and crashed the main process.
- **Ghostery can't natively block in two sessions**: each attach registers the
  same process-wide `ipcMain.handle` channels, so the second attach threw before
  that session's network blocking was set up. `AdBlock.enableIn` drops the
  previous registration first (all sessions attach/detach together, same engine).
- **This dev machine is slow to spawn Chromium processes** (likely endpoint
  security): a bare Electron window takes ~8 s, each new tab ~5–10 s, and Bro's
  first launch burns ~30 s of CPU before it's idle. Don't read those numbers as
  Bro regressions without comparing against a bare Electron app.
- **`electron-chrome-extensions` is GPL-3.0.** The app passes `license: 'GPL-3.0'`;
  this makes that component GPL — factor into distribution licensing.
- Packages that resolve their own preload paths at load time (`@ghostery/*`,
  `electron-chrome-*`) must stay **external** in esbuild (never bundled), or they
  crash with `require.resolve ... undefined`.
- The **chrome UI view runs `sandbox:false`** (contextIsolation still on) so its
  preload can inject the extension toolbar. **Tabs stay sandboxed** — untrusted
  web content never gets Node.
- Adblock filter lists need one online fetch to populate the on-disk cache; on a
  proxy that blocks the list CDNs it will show an error + Retry (a bundled-list
  fallback is the mitigation if needed).

### Still to do

- ~~Profiles / containers~~ — done 2026-10-12 (see above). Notes kept for history:
  Phase 4 item. It's entangled with the current design: adblock and the
  extension system are attached to **`session.defaultSession`**, and all tabs use
  it. Real multi-profile means giving each profile its own session and
  **re-attaching** the blocker + extensions per session (and deciding whether
  extensions are shared or per-profile). Private tabs (done) already attach
  the blocker to a second session; per-profile extensions + a switcher remain.
- **Mac packaging** needs a Mac to build/sign/notarize (Apple Developer account);
  app **icons** (`build/icon.ico` / `.icns`) to be added.
- Point the auto-update `publish.url` at a real release host (currently
  `https://example.com/bro/updates/`).
- Untested: fullscreen requested by a page (e.g. a video's ⛶ button). The tab
  view probably needs re-laying-out to cover the toolbar while it's active.

---

## 8. Known risks & limits (don't paper over these)

- **Capture exclusion is software-only** — a phone/HDMI capture still sees the
  screen. Must be stated in-product.
- **macOS capture behavior shifts between OS versions** — treat the invisibility
  guarantee as "verified on tested versions," and gate releases on a per-version
  capture test.
- **Electron size & startup** — ~150–200 MB per app, heavier cold start than a
  native browser. Acceptable for v1; a fork would fix it at huge cost.
- **Extension API is a subset** of Chrome's — most content blockers work; some
  deep MV3 / enterprise APIs may not.
- **Signing/notarization friction** on macOS — unsigned/un-notarized builds are
  gatekept; an Apple Developer account ($99/yr) is required to distribute.
- **Memory under many tabs** — same as Chromium; tab-sleeping mitigates but
  doesn't eliminate.
- **Ethics/legal** — ship the consent reminder; position capture-hiding as
  protecting *the user's own* screen content, not surveilling others.

---

## 9. TL;DR

Build on **Electron + TypeScript**, tabs as **`WebContentsView`**, UI in
**React/Vite**, ad-block via **Ghostery**, package with **electron-builder** for
Windows + macOS. The two headline features are single native calls your AI-App
already uses in production: `setContentProtection(true)` (invisible to screen
share, `WDA_EXCLUDEFROMCAPTURE` on Windows / `NSWindowSharingNone` on macOS) and
`setOpacity()` (ghosting). It browses like Chrome because it *is* Chromium; it's
faster/lighter than Chrome because it blocks ads/trackers and strips telemetry
and background services. A full Chromium/Brave fork stays a long-term north star,
not the PoC.
```
