// Library overlay: Bookmarks, History and saved Sessions. Clicking a bookmark
// or history item navigates the active tab and closes the overlay; clicking a
// session reopens its tabs. Uses the privileged `window.bro` bridge.
import {
  type Bookmark,
  type DownloadAction,
  type DownloadInfo,
  type HistoryEntry,
  type ProfilesState,
  type LibraryView,
  type OfflineAction,
  type OfflineItem,
  type SavedSession,
} from '../shared/ipc-contract';

const bro = window.bro;
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

let view: LibraryView = 'bookmarks';
let bookmarks: Bookmark[] = [];
let history: HistoryEntry[] = [];
let sessions: SavedSession[] = [];
let downloads: DownloadInfo[] = [];
let offline: OfflineItem[] = [];
let profiles: ProfilesState | null = null;
let filter = '';

const listEl = $('list');
const emptyEl = $('empty');
const clearBtn = $<HTMLButtonElement>('clear-history');
const filterEl = $<HTMLInputElement>('filter');
const saveForm = $<HTMLFormElement>('save-session');
const sessionName = $<HTMLInputElement>('session-name');
const viewTabs: Record<LibraryView, HTMLElement> = {
  bookmarks: $('tab-bookmarks'),
  history: $('tab-history'),
  sessions: $('tab-sessions'),
  downloads: $('tab-downloads'),
  offline: $('tab-offline'),
};
const clearDownloadsBtn = $<HTMLButtonElement>('clear-downloads');
const profileNote = $('profile-note');
clearDownloadsBtn.addEventListener('click', () => bro.clearDownloads());
const clearOfflineBtn = $<HTMLButtonElement>('clear-offline');
clearOfflineBtn.addEventListener('click', () => bro.clearOffline());

/** Opened as a page in a tab (bro://downloads, bro://offline) rather than over the page. */
const inTab = new URLSearchParams(location.search).has('tab');
const VIEW_TITLES: Record<LibraryView, string> = {
  bookmarks: 'Bookmarks',
  history: 'History',
  sessions: 'Sessions',
  downloads: 'Downloads',
  offline: 'Offline videos',
};

// --- Header controls -------------------------------------------------------
$('close').hidden = inTab; // a tab is closed like any tab
$('close').addEventListener('click', () => bro.closeLibrary());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !inTab) bro.closeLibrary();
});

for (const [v, el] of Object.entries(viewTabs) as [LibraryView, HTMLElement][]) {
  el.addEventListener('click', () => setView(v));
}
clearBtn.addEventListener('click', () => {
  bro.clearHistory();
});
filterEl.addEventListener('input', () => {
  filter = filterEl.value.trim().toLowerCase();
  render();
});
saveForm.addEventListener('submit', (e) => {
  e.preventDefault();
  bro.saveSession(sessionName.value);
  sessionName.value = '';
});

function setView(v: LibraryView): void {
  view = v;
  for (const [k, el] of Object.entries(viewTabs)) el.classList.toggle('active', k === v);
  clearBtn.hidden = v !== 'history';
  clearDownloadsBtn.hidden = v !== 'downloads';
  clearOfflineBtn.hidden = v !== 'offline';
  saveForm.hidden = v !== 'sessions';
  if (inTab) {
    // The address bar shows bro://<view>, and the tab is named after it.
    window.history.replaceState(null, '', `#${v}`);
    document.title = VIEW_TITLES[v];
  }
  render();
}

// Opened on a specific view (Ctrl/Cmd+H → History, Ctrl/Cmd+Shift+D → Sessions).
bro.onLibraryView(setView);
if (inTab) {
  const start = location.hash.slice(1) as LibraryView;
  setView(start in VIEW_TITLES ? start : 'downloads');
}

// --- Rendering -------------------------------------------------------------
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

interface Row {
  title: string;
  sub: string;
  meta: string;
  tooltip?: string;
  open: () => void;
  remove?: { label: string; run: () => void };
}

function rows(): Row[] {
  const match = (...texts: string[]) => !filter || texts.some((t) => t.toLowerCase().includes(filter));
  if (view === 'sessions') {
    return sessions
      .filter((s) => match(s.name, ...s.tabs.flatMap((t) => [t.title, t.url])))
      .map((s) => ({
        title: s.name,
        sub: `${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'} · ${s.tabs
          .slice(0, 3)
          .map((t) => t.title || prettyUrl(t.url))
          .join(', ')}${s.tabs.length > 3 ? ', …' : ''}`,
        meta: timeAgo(s.ts),
        tooltip: s.tabs.map((t) => t.title || t.url).join('\n'),
        open: () => bro.openSession(s.id),
        remove: { label: 'Delete session', run: () => bro.removeSession(s.id) },
      }));
  }
  const items = view === 'bookmarks' ? bookmarks : history;
  return items
    .filter((i) => match(i.title, i.url))
    .map((i) => ({
      title: i.title,
      sub: prettyUrl(i.url),
      meta: timeAgo(i.ts),
      open: () => {
        bro.navigate(i.url);
        bro.closeLibrary();
      },
      remove:
        view === 'bookmarks' ? { label: 'Remove bookmark', run: () => bro.removeBookmark(i.url) } : undefined,
    }));
}

function render(): void {
  renderProfileNote();
  if (view === 'downloads') return renderDownloads();
  if (view === 'offline') return renderOffline();
  const list = rows();
  listEl.replaceChildren();
  emptyEl.hidden = list.length > 0;
  emptyEl.textContent =
    view === 'sessions' && !filter
      ? 'No saved sessions yet. Name the tabs you have open and save them above.'
      : 'Nothing here yet.';

  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'lib-item';

    const main = document.createElement('button');
    main.className = 'lib-item-main';
    if (item.tooltip) main.title = item.tooltip;
    main.addEventListener('click', item.open);

    const title = document.createElement('span');
    title.className = 'lib-item-title';
    title.textContent = item.title;
    const sub = document.createElement('span');
    sub.className = 'lib-item-url';
    sub.textContent = item.sub;
    const meta = document.createElement('span');
    meta.className = 'lib-item-meta';
    meta.textContent = item.meta;

    main.appendChild(title);
    main.appendChild(sub);
    main.appendChild(meta);
    row.appendChild(main);

    if (item.remove) {
      const { label, run } = item.remove;
      const del = document.createElement('button');
      del.className = 'lib-item-del';
      del.textContent = '✕';
      del.title = label;
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        run();
      });
      row.appendChild(del);
    }

    listEl.appendChild(row);
  }
}

/** Bookmarks + history belong to a profile; say whose they are when there are several. */
function renderProfileNote(): void {
  const p = profiles && profiles.profiles.length > 1 ? profiles.profiles.find((x) => x.id === profiles!.current) : null;
  profileNote.hidden = !p || (view !== 'bookmarks' && view !== 'history');
  if (p) profileNote.textContent = `Showing ${view} of the ${p.name} profile.`;
}

// --- Downloads -------------------------------------------------------------

const fmtBytes = (n: number): string => {
  if (n < 0) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const fmtTime = (s: number): string =>
  s < 60 ? `${Math.ceil(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;

function downloadLine(d: DownloadInfo): string {
  const size = d.total > 0 ? `${fmtBytes(d.received)} of ${fmtBytes(d.total)}` : fmtBytes(d.received);
  switch (d.status) {
    case 'downloading': {
      const parts = [size];
      if (d.speed > 0) {
        parts.push(`${fmtBytes(d.speed)}/s`);
        if (d.total > 0) parts.push(`${fmtTime((d.total - d.received) / d.speed)} left`);
      } else parts.push('starting…');
      if (d.engine === 'segmented') parts.push(`${d.connections} connection${d.connections === 1 ? '' : 's'}`);
      if (d.retries) parts.push(`${d.retries} retr${d.retries === 1 ? 'y' : 'ies'}`);
      return parts.join(' · ');
    }
    case 'paused':
      return `Paused · ${size}${d.resumable ? ' · resumable' : ''}`;
    case 'interrupted':
      return `Interrupted · ${size} · ${d.error ?? 'retrying'}`;
    case 'completed':
      return `${fmtBytes(d.total > 0 ? d.total : d.received)} · done ${timeAgo(d.finished ?? d.started)}`;
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return `Failed · ${d.error ?? 'unknown error'}`;
  }
}

function renderDownloads(): void {
  const list = downloads.filter(
    (d) => !filter || d.filename.toLowerCase().includes(filter) || d.url.toLowerCase().includes(filter),
  );
  listEl.replaceChildren();
  emptyEl.hidden = list.length > 0;
  emptyEl.textContent = filter
    ? 'Nothing matches.'
    : 'No downloads yet. Files you download (or “Save … as” from the right-click menu) appear here.';
  for (const d of list) {
    const row = document.createElement('div');
    row.className = `dl-item dl-${d.status}`;
    row.dataset.id = d.id;

    const name = document.createElement(d.status === 'completed' ? 'button' : 'span');
    name.className = 'dl-name';
    name.textContent = d.filename;
    name.title = d.path;
    if (d.status === 'completed') name.addEventListener('click', () => bro.downloadAction(d.id, 'open'));

    const meta = document.createElement('span');
    meta.className = 'dl-meta';
    meta.textContent = downloadLine(d) + (d.private ? ' · private' : '');

    const bar = document.createElement('div');
    bar.className = 'dl-bar';
    const fill = document.createElement('div');
    fill.className = 'dl-fill';
    if (d.total > 0) fill.style.width = `${Math.min(100, (d.received / d.total) * 100).toFixed(1)}%`;
    else fill.classList.add('indeterminate');
    bar.appendChild(fill);

    const actions = document.createElement('div');
    actions.className = 'dl-actions';
    const act = (label: string, action: DownloadAction, title = label) => {
      const b = document.createElement('button');
      b.className = 'text-btn small';
      b.textContent = label;
      b.title = title;
      b.dataset.action = action;
      b.addEventListener('click', () => bro.downloadAction(d.id, action));
      actions.appendChild(b);
    };
    if (d.status === 'downloading') {
      if (d.engine === 'segmented' || d.resumable) act('Pause', 'pause');
      act('Cancel', 'cancel');
    } else if (d.status === 'paused' || d.status === 'interrupted') {
      act('Resume', 'resume');
      act('Cancel', 'cancel');
    } else if (d.status === 'completed') {
      act('Open', 'open');
      act('Show in folder', 'show');
    } else {
      act('Retry', 'retry');
    }
    act('✕', 'remove', 'Remove from list (keeps the file)');

    const main = document.createElement('div');
    main.className = 'dl-main';
    main.append(name, meta);
    if (d.status === 'downloading' || d.status === 'paused' || d.status === 'interrupted') main.appendChild(bar);
    row.append(main, actions);
    listEl.appendChild(row);
  }
}

// --- Offline (saved pages + videos) ------------------------------------------

function offlineLine(o: OfflineItem): string {
  switch (o.status) {
    case 'working': {
      const parts = [o.stage];
      if (o.total > 0 && o.total !== 1000) parts.push(`${fmtBytes(o.received)} of ${fmtBytes(o.total)}`);
      else if (o.total === 1000) parts.push(`${Math.round(o.received / 10)}%`);
      else if (o.received > 0) parts.push(fmtBytes(o.received));
      if (o.speed > 0) parts.push(`${fmtBytes(o.speed)}/s`);
      if (o.eta > 0) parts.push(`${fmtTime(o.eta)} left`);
      return parts.join(' · ');
    }
    case 'queued':
      return 'Waiting for the save before it to finish';
    case 'paused':
      return o.stage && o.stage !== 'Paused' ? `Paused · ${o.stage}` : 'Paused — Resume continues where it stopped';
    case 'interrupted':
      return o.stage;
    case 'completed':
      return `${o.stage} · ${timeAgo(o.finished ?? o.started)}`;
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return `Failed · ${o.error ?? 'unknown error'}`;
  }
}

function renderOffline(): void {
  const list = offline.filter((o) => !filter || o.title.toLowerCase().includes(filter) || o.pageUrl.toLowerCase().includes(filter));
  listEl.replaceChildren();
  emptyEl.hidden = list.length > 0;
  emptyEl.textContent = filter
    ? 'Nothing matches.'
    : 'Nothing saved yet. On any page with a video (a course, a talk, a tutorial), press Ctrl/Cmd+S or the ' +
      'Save for offline button next to Downloads. Bro keeps the page and the video in your Downloads folder ' +
      'under “Bro Offline”, and you can watch it here without internet.';
  for (const o of list) {
    const row = document.createElement('div');
    row.className = `dl-item dl-${o.status === 'working' || o.status === 'queued' ? 'downloading' : o.status}`;
    row.dataset.id = o.id;

    const done = o.status === 'completed';
    const name = document.createElement(done ? 'button' : 'span');
    name.className = 'dl-name';
    name.textContent = o.title;
    name.title = `${o.pageUrl}
${o.folder}`;
    if (done) name.addEventListener('click', () => bro.offlineAction(o.id, 'open'));

    const meta = document.createElement('span');
    meta.className = 'dl-meta';
    meta.textContent = offlineLine(o) + (o.private ? ' · private' : '');
    meta.title = meta.textContent;

    const main = document.createElement('div');
    main.className = 'dl-main';
    main.append(name, meta);
    if (o.status === 'working') {
      const bar = document.createElement('div');
      bar.className = 'dl-bar';
      const fill = document.createElement('div');
      fill.className = 'dl-fill';
      if (o.total > 0) fill.style.width = `${Math.min(100, (o.received / o.total) * 100).toFixed(1)}%`;
      else fill.classList.add('indeterminate');
      bar.appendChild(fill);
      main.appendChild(bar);
    }

    const actions = document.createElement('div');
    actions.className = 'dl-actions';
    const act = (label: string, action: OfflineAction, title = label) => {
      const b = document.createElement('button');
      b.className = 'text-btn small';
      b.textContent = label;
      b.title = title;
      b.dataset.action = action;
      b.addEventListener('click', () => {
        if (action === 'delete' && !confirm(`Delete “${o.title}” and its saved files from your computer?`)) return;
        bro.offlineAction(o.id, action);
      });
      actions.appendChild(b);
    };
    if (o.status === 'working' || o.status === 'queued') {
      act('Pause', 'pause');
      act('Cancel', 'cancel');
    } else if (o.status === 'paused' || o.status === 'interrupted') {
      act('Resume', 'resume');
      act('Cancel', 'cancel');
    } else if (done) {
      act(o.videos ? 'Watch' : 'Open', 'open');
      act('Show folder', 'show');
      act('Delete', 'delete', 'Delete the saved files');
    } else {
      act('Retry', 'retry');
    }
    act('✕', 'remove', 'Remove from list (keeps the files)');
    row.append(main, actions);
    listEl.appendChild(row);
  }
}

function prettyUrl(u: string): string {
  try {
    return new URL(u).host + new URL(u).pathname.replace(/\/$/, '');
  } catch {
    return u;
  }
}

// --- Data sync -------------------------------------------------------------
bro.onBookmarksChanged((b) => {
  bookmarks = b;
  if (view === 'bookmarks') render();
});
bro.onHistoryChanged((h) => {
  history = h;
  if (view === 'history') render();
});
// Progress redraws the list ~2x a second; never swap a row out from under a click.
let pressing = false;
let redrawPending = false;
listEl.addEventListener('pointerdown', () => (pressing = true));
window.addEventListener('pointerup', () => {
  pressing = false;
  if (redrawPending) {
    redrawPending = false;
    setTimeout(render); // after the click has fired
  }
});
bro.onDownloadsChanged((d) => {
  downloads = d;
  if (view !== 'downloads') return;
  if (pressing) redrawPending = true;
  else render();
});
bro.onOfflineChanged((o) => {
  offline = o;
  if (view !== 'offline') return;
  if (pressing) redrawPending = true;
  else render();
});
void bro.getOffline().then((o) => {
  offline = o;
  if (view === 'offline') render();
});
bro.onProfilesChanged((p) => {
  profiles = p;
  renderProfileNote();
});
void bro.getDownloads().then((d) => {
  downloads = d;
  if (view === 'downloads') render();
});
void bro.getProfiles().then((p) => {
  profiles = p;
  renderProfileNote();
});

bro.onSessionsChanged((s) => {
  sessions = s;
  if (view === 'sessions') render();
});

void bro.getBookmarks().then((b) => {
  bookmarks = b;
  render();
});
void bro.getHistory().then((h) => {
  history = h;
  if (view === 'history') render();
});
void bro.getSessions().then((s) => {
  sessions = s;
  if (view === 'sessions') render();
});
