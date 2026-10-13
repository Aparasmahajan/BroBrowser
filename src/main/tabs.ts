import { WebContentsView, type BrowserWindow, type ContextMenuParams, type Session, type WebContents, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Event,
  type FindPayload,
  type SearchConfig,
  type SessionTab,
  type TabState,
} from '../shared/ipc-contract';
import { DEFAULT_SEARCH } from './search';

const START_PAGE = join(__dirname, '../ui/start.html');
// pathToFileURL handles Windows drive letters → file:///C:/... correctly.
const START_URL = pathToFileURL(START_PAGE).href;
/** The start page shows a "you're private" notice when it sees this. */
const PRIVATE_START_URL = `${START_URL}?private=1`;

const CLOSED_CAP = 25; // how many closed tabs Ctrl/Cmd+Shift+T can bring back
// Chrome's zoom ladder.
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where tabs get their sessions from (Browser wires ad blocking, downloads, extensions per session). */
export interface TabSessions {
  forProfile(profileId: string): Session;
  partition(profileId: string): string;
  validProfile(id: string | undefined): string;
  readonly privateSession: Session;
  readonly privatePartition: string;
}

/** What a right-click needs to know about the tab it happened in. */
export interface TabContext {
  tabId: number;
  private: boolean;
  profileId: string;
}

interface Tab {
  id: number;
  /** Profile the tab belongs to (meaningless for private tabs). */
  profileId: string;
  view: WebContentsView;
  favicon?: string;
  /** Lives in the in-memory private session: no history, no extensions, not saved. */
  private: boolean;
  /** Restored but not loaded yet — loads on first activation (keeps startup fast). */
  sleeping?: SessionTab;
}

/** A closed tab, remembered for Ctrl/Cmd+Shift+T. */
type ClosedTab = SessionTab & { private: boolean; profileId: string };

const isStartUrl = (url: string) => url.startsWith('file://') && url.includes('start.html');

/**
 * Turn whatever the user typed into a navigable URL. "yt lofi" (or "!yt lofi")
 * runs the "yt" site search; plain words go to the default engine.
 */
export function resolveInput(raw: string, search: SearchConfig = DEFAULT_SEARCH): string {
  const input = raw.trim();
  if (!input) return START_URL;
  if (/^(https?|file|about|view-source|chrome):/i.test(input)) return input;

  const fill = (tpl: string, q: string) => tpl.replace(/%s/g, encodeURIComponent(q));
  const kw = /^!?(\S+)\s+(.+)$/.exec(input);
  const engine = kw && search.engines.find((e) => e.keyword.toLowerCase() === kw[1].toLowerCase());
  if (kw && engine) return fill(engine.url, kw[2]);

  // Looks like a host/domain (has a dot, no spaces) or localhost → treat as URL.
  const looksLikeUrl = /^[^\s]+\.[^\s]+$/.test(input) || /^localhost(:\d+)?/.test(input);
  if (looksLikeUrl) return `https://${input}`;
  const def =
    search.engines.find((e) => e.keyword === search.defaultKeyword) ?? DEFAULT_SEARCH.engines[0];
  return fill(def.url, input);
}

/**
 * Creates, destroys and lays out browser tabs. Each tab is a fully isolated
 * Chromium WebContentsView (same process-isolation model as a Chrome tab).
 * Web content gets NO privileged preload — only the trusted chrome/settings
 * views do.
 */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId = -1;
  private nextId = 1;
  private closed: ClosedTab[] = [];
  private findTabId = -1;
  private creating = false;
  /** The window is closing: its tabs are being torn down, don't replace them. */
  private windowClosing = false;

  /** Lifecycle hooks so the extension system can track tabs. Set by Browser. */
  hooks: {
    onCreated?: (wc: WebContents, profileId: string) => void;
    onActivated?: (wc: WebContents, profileId: string) => void;
    onRemoved?: (wc: WebContents, profileId: string) => void;
  } = {};
  /** Right-click inside a tab. Set by Browser. */
  onContextMenu: (wc: WebContents, params: ContextMenuParams, ctx: TabContext) => void = () => {};
  /** Current omnibox search config. Set by Browser. */
  search: () => SearchConfig = () => DEFAULT_SEARCH;
  /** Every new tab's webContents (shortcut routing). Set by Browser. */
  onWebContents: (wc: WebContents) => void = () => {};
  /** After any tab-list change (session autosave). Set by Browser. */
  onChanged: () => void = () => {};

  constructor(
    private win: BrowserWindow,
    private region: () => Rect,
    private emit: (channel: string, payload: unknown) => void,
    private onVisit: (profileId: string, url: string, title: string) => void,
    private isBookmarked: (profileId: string, url: string) => boolean,
    private sessions: TabSessions,
    /** Profile new tabs open in until a tab is activated. */
    private lastProfile: string,
  ) {
    win.once('close', () => (this.windowClosing = true));
  }

  /** Profile of the active tab, or of the last non-private tab used — new tabs open there. */
  get currentProfile(): string {
    const active = this.tabs.find((t) => t.id === this.activeId);
    return this.sessions.validProfile(active && !active.private ? active.profileId : this.lastProfile);
  }

  /** Close every tab of a profile (it's being removed). */
  closeProfileTabs(profileId: string): void {
    for (const t of this.tabs.filter((x) => !x.private && x.profileId === profileId)) this.closeTab(t.id);
    this.closed = this.closed.filter((t) => t.private || t.profileId !== profileId);
    if (this.lastProfile === profileId) this.lastProfile = this.sessions.validProfile(undefined);
  }

  get activeView(): WebContentsView | undefined {
    return this.tabs.find((t) => t.id === this.activeId)?.view;
  }

  get activeWebContents(): WebContents | undefined {
    return this.activeView?.webContents;
  }

  /** True while a new tab is being registered with the extension system. */
  get isCreating(): boolean {
    return this.creating;
  }

  activeInfo(): { url: string; title: string } | null {
    const v = this.activeView;
    if (!v) return null;
    return { url: v.webContents.getURL(), title: v.webContents.getTitle() };
  }

  webContentsFor(id: number): WebContents | undefined {
    return this.tabs.find((t) => t.id === id)?.view.webContents;
  }

  idForWebContents(wc: WebContents): number | undefined {
    return this.tabs.find((t) => t.view.webContents === wc)?.id;
  }

  resolve(input: string): string {
    return resolveInput(input, this.search());
  }

  newTab(
    url?: string,
    opts: { background?: boolean; sleeping?: SessionTab; private?: boolean; profileId?: string } = {},
  ): number {
    const isPrivate = !!opts.private;
    const profileId = this.sessions.validProfile(opts.profileId ?? opts.sleeping?.profileId ?? this.currentProfile);
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Run session preloads (YouTube shield, ad blocker) in iframes too, e.g.
        // YouTube players embedded in other sites. Tabs stay sandboxed, so this
        // gives frames no Node access.
        nodeIntegrationInSubFrames: true,
        session: isPrivate ? this.sessions.privateSession : this.sessions.forProfile(profileId),
      },
    });
    const id = this.nextId++;
    const tab: Tab = { id, view, profileId, private: isPrivate, sleeping: opts.sleeping, favicon: opts.sleeping?.favicon };
    this.tabs.push(tab);
    this.win.contentView.addChildView(view);

    this.wire(tab);
    this.onWebContents(view.webContents);
    if (!opts.sleeping) void view.webContents.loadURL(this.urlFor(tab, url ?? ''));
    // The extension system marks every tab it's told about as active and asks
    // us to select it; `creating` lets Extensions ignore that echo, otherwise
    // background and restored tabs would all wake up and steal focus.
    this.creating = true;
    try {
      this.hook(tab, this.hooks.onCreated);
    } finally {
      this.creating = false;
    }

    if (opts.background) {
      // Tell the extension system which tab is really still active.
      const active = this.tabs.find((t) => t.id === this.activeId);
      if (active) this.hook(active, this.hooks.onActivated);
      this.layout();
      this.emitChanged();
    } else {
      this.activate(id);
    }
    return id;
  }

  /** Reopen tabs from a session: all asleep, then wake the one that was active. */
  restore(list: SessionTab[], activeIndex = 0): void {
    const ids = list.map((t) => this.newTab(undefined, { background: true, sleeping: t }));
    const target = ids[activeIndex] ?? ids[0];
    if (target != null) this.activate(target);
  }

  closeTab(id: number): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return; // idempotent — already gone
    const [tab] = this.tabs.splice(idx, 1);
    const snap = this.snapshotOf(tab);
    if (snap) {
      this.closed.push({ ...snap, private: tab.private, profileId: tab.profileId });
      if (this.closed.length > CLOSED_CAP) this.closed.shift();
    }
    const wc = tab.view.webContents;
    // This can run after the WebContents was already destroyed (e.g. the
    // extension system calls back when a page closes itself), so every step
    // is guarded — touching a destroyed object otherwise crashes the process.
    try { this.hook(tab, this.hooks.onRemoved); } catch { /* already gone */ }
    try { this.win.contentView.removeChildView(tab.view); } catch { /* already gone */ }
    try { if (wc && !wc.isDestroyed()) wc.close(); } catch { /* already gone */ }
    if (tab.private && !this.tabs.some((t) => t.private)) this.endPrivate();

    if (this.activeId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1];
      if (next) this.activate(next.id);
      else if (!this.windowClosing) this.newTab(); // never leave zero tabs
    } else {
      this.emitChanged();
    }
  }

  closeActive(): void {
    this.closeTab(this.activeId);
  }

  reopenClosed(): void {
    const t = this.closed.pop();
    if (t) this.newTab(t.url, { private: t.private, profileId: t.profileId });
  }

  duplicate(): void {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    const snap = tab && this.snapshotOf(tab);
    this.newTab(snap?.url, { private: tab?.private, profileId: tab?.profileId });
  }

  /** Last private tab closed: forget everything it did, like closing Incognito. */
  private endPrivate(): void {
    this.closed = this.closed.filter((t) => !t.private);
    const s = this.sessions.privateSession;
    void s.clearStorageData().catch(() => {});
    void s.clearCache().catch(() => {});
    void s.clearAuthCache().catch(() => {});
  }

  /** Extensions never see private tabs (Chrome's default for Incognito). */
  private hook(tab: Tab, fn?: (wc: WebContents, profileId: string) => void): void {
    if (!tab.private) fn?.(tab.view.webContents, tab.profileId);
  }

  /** Resolve omnibox input; empty input is the start page (with the private notice if needed). */
  private urlFor(tab: Tab, input: string): string {
    const url = this.resolve(input);
    return url === START_URL && tab.private ? PRIVATE_START_URL : url;
  }

  activate(id: number): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;
    if (!tab.private) this.lastProfile = tab.profileId;
    if (tab.sleeping) {
      const { url } = tab.sleeping;
      tab.sleeping = undefined;
      void tab.view.webContents.loadURL(url);
    }
    this.hook(tab, this.hooks.onActivated);
    this.layout();
    this.emitChanged();
  }

  /** Ctrl+Tab / Ctrl+Shift+Tab — wraps around. */
  cycle(dir: 1 | -1): void {
    const n = this.tabs.length;
    if (n < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + dir + n) % n].id);
  }

  /** Ctrl+1…8 select by position; -1 is the last tab (Ctrl+9). */
  activateIndex(i: number): void {
    const tab = i < 0 ? this.tabs[this.tabs.length - 1] : this.tabs[i];
    if (tab) this.activate(tab.id);
  }

  navigate(input: string, id?: number): void {
    const tab = this.tabs.find((t) => t.id === (id ?? this.activeId));
    if (tab) void tab.view.webContents.loadURL(this.urlFor(tab, input));
  }

  back(id?: number): void {
    const wc = this.viewFor(id)?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(id?: number): void {
    const wc = this.viewFor(id)?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id?: number, ignoreCache = false): void {
    const wc = this.viewFor(id)?.webContents;
    if (ignoreCache) wc?.reloadIgnoringCache();
    else wc?.reload();
  }

  stop(id?: number): void {
    this.viewFor(id)?.webContents.stop();
  }

  /** +1 / -1 step along the zoom ladder; 0 resets to 100%. */
  zoom(dir: 1 | -1 | 0, id?: number): void {
    const wc = this.viewFor(id)?.webContents;
    if (!wc) return;
    const cur = wc.getZoomFactor();
    const next =
      dir === 0
        ? 1
        : dir > 0
          ? (ZOOM_STEPS.find((s) => s > cur + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
          : ([...ZOOM_STEPS].reverse().find((s) => s < cur - 0.001) ?? ZOOM_STEPS[0]);
    wc.setZoomFactor(next);
    this.emitChanged();
  }

  viewSource(): void {
    const url = this.activeWebContents?.getURL() ?? '';
    if (/^https?:/i.test(url)) this.newTab(`view-source:${url}`);
  }

  find(p: FindPayload): void {
    const wc = this.activeWebContents;
    if (!wc) return;
    if (!p.text) {
      wc.stopFindInPage('clearSelection');
      this.emit(Event.FindResult, { active: 0, total: 0 });
      return;
    }
    // Electron's `findNext: true` means "start a new search session". A tab
    // we haven't searched yet always needs a fresh one.
    const newSession = p.newSession || this.findTabId !== this.activeId;
    this.findTabId = this.activeId;
    wc.findInPage(p.text, { forward: p.forward, findNext: newSession });
  }

  stopFind(): void {
    this.activeWebContents?.stopFindInPage('keepSelection');
    this.findTabId = -1;
  }

  /** Reposition the active view; hide the rest. */
  layout(): void {
    const r = this.region();
    for (const tab of this.tabs) {
      const isActive = tab.id === this.activeId;
      tab.view.setVisible(isActive);
      if (isActive) {
        this.win.contentView.addChildView(tab.view); // raise to top of tab stack
        tab.view.setBounds(r);
      }
    }
  }

  list(): TabState[] {
    return this.tabs.map((t) => this.stateOf(t));
  }

  /** Open tabs as {url,title}, skipping blank start pages — for session saving. */
  snapshot(): { tabs: SessionTab[]; active: number } {
    const out: SessionTab[] = [];
    let active = 0;
    for (const t of this.tabs) {
      const s = t.private ? null : this.snapshotOf(t); // private tabs are never saved
      if (!s) continue;
      if (t.id === this.activeId) active = out.length;
      out.push(s);
    }
    return { tabs: out, active };
  }

  // --- internals -----------------------------------------------------------

  private viewFor(id?: number): WebContentsView | undefined {
    if (id == null) return this.activeView;
    return this.tabs.find((t) => t.id === id)?.view;
  }

  private snapshotOf(tab: Tab): SessionTab | null {
    if (tab.sleeping) return { ...tab.sleeping, profileId: tab.profileId };
    const wc = tab.view.webContents;
    if (!wc || wc.isDestroyed()) return null;
    const url = wc.getURL();
    if (!url || isStartUrl(url)) return null;
    return { url, title: wc.getTitle(), favicon: tab.favicon, profileId: tab.profileId };
  }

  private wire(tab: Tab): void {
    const wc = tab.view.webContents;
    const changed = () => this.emitChanged();

    // The page closed itself (window.close()), crashed for good, or was closed
    // from outside: drop the tab, or every later tab list would touch a dead view.
    wc.once('destroyed', () => {
      if (!this.windowClosing) this.closeTab(tab.id);
    });

    // Private tabs leave no history.
    const visit = (title: string) => {
      if (!tab.private) this.onVisit(tab.profileId, wc.getURL(), title);
    };
    const recordVisit = () => visit(wc.getTitle());

    wc.on('page-title-updated', (_e, title) => {
      visit(title); // refine the history entry's title
      changed();
    });
    wc.on('did-navigate', () => {
      recordVisit();
      changed();
    });
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => {
      if (isMainFrame) recordVisit();
      changed();
    });
    wc.on('did-start-loading', changed);
    wc.on('did-stop-loading', changed);
    wc.on('page-favicon-updated', (_e, icons) => {
      tab.favicon = icons[0];
      changed();
    });

    wc.on('found-in-page', (_e, r) => {
      if (tab.id === this.activeId) {
        this.emit(Event.FindResult, { active: r.activeMatchOrdinal, total: r.matches });
      }
    });

    // Ctrl/Cmd + mouse wheel (or pinch) → zoom, like Chrome.
    wc.on('zoom-changed', (_e, dir) => this.zoom(dir === 'in' ? 1 : -1, tab.id));

    // The start page has no bridge; its search box navigates to
    // start.html?q=… and we resolve that here, so keywords + the default
    // engine apply there too.
    wc.on('will-navigate', (e, url) => {
      if (!isStartUrl(url)) return;
      const q = new URL(url).searchParams.get('q');
      if (q == null) return;
      e.preventDefault();
      void wc.loadURL(this.urlFor(tab, q));
    });

    wc.on('context-menu', (_e, params) =>
      this.onContextMenu(wc, params, { tabId: tab.id, private: tab.private, profileId: tab.profileId }),
    );

    // target=_blank / window.open → open as a new tab instead of a popup.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.newTab(url, { private: tab.private, profileId: tab.profileId }); // links keep private/profile
      else void shell.openExternal(url); // mailto:, etc.
      return { action: 'deny' };
    });
  }

  private stateOf(tab: Tab): TabState {
    const wc = tab.view.webContents;
    const active = tab.id === this.activeId;
    if (tab.sleeping || !wc || wc.isDestroyed()) {
      const s = tab.sleeping ?? { url: '', title: '' };
      return {
        id: tab.id,
        title: s.title || s.url || 'New Tab',
        url: s.url,
        active,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        bookmarked: !!s.url && !tab.private && this.isBookmarked(tab.profileId, s.url),
        favicon: tab.favicon,
        zoom: 1,
        sleeping: !!tab.sleeping,
        private: tab.private,
        profileId: tab.profileId,
        partition: this.partitionOf(tab),
      };
    }
    const url = wc.getURL();
    const isStart = isStartUrl(url);
    return {
      id: tab.id,
      title: isStart ? 'New Tab' : wc.getTitle() || 'Loading…',
      url: isStart ? '' : url,
      active,
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      bookmarked: !isStart && !tab.private && this.isBookmarked(tab.profileId, url),
      favicon: tab.favicon,
      zoom: wc.getZoomFactor(),
      sleeping: false,
      private: tab.private,
      profileId: tab.profileId,
      partition: this.partitionOf(tab),
    };
  }

  private partitionOf(tab: Tab): string {
    return tab.private ? this.sessions.privatePartition : this.sessions.partition(tab.profileId);
  }

  private emitChanged(): void {
    this.emit(Event.TabsChanged, this.list());
    this.onChanged();
  }
}

export type { WebContents };
