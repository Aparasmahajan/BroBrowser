// Browser chrome: renders the tab strip + toolbar and drives navigation via the
// typed `window.bro` bridge. The screen-share control is NOT here — it lives on
// the Settings page (gear button / Ctrl/Cmd+Shift+S).
import { type DownloadInfo, type ProfilesState, type SearchConfig, type TabState } from '../shared/ipc-contract';

const bro = window.bro;
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const isMac = bro.platform === 'darwin';
if (isMac) document.body.classList.add('is-mac'); // native traffic lights → hide ours

// --- Window controls -------------------------------------------------------
$('btn-min').addEventListener('click', () => bro.minimize());
$('btn-max').addEventListener('click', () => bro.toggleMaximize());
$('btn-close').addEventListener('click', () => bro.close());

// --- Toolbar actions -------------------------------------------------------
$('btn-back').addEventListener('click', () => bro.goBack());
$('btn-forward').addEventListener('click', () => bro.goForward());
$('btn-reload').addEventListener('click', () => bro.reload());
$('new-tab').addEventListener('click', () => bro.newTab());
$('new-private').addEventListener('click', () => bro.runCommand('tab.newPrivate'));
$('btn-settings').addEventListener('click', () => bro.toggleSettings());
$('btn-library').addEventListener('click', () => bro.toggleLibrary());
$('shield').addEventListener('click', () => bro.toggleSettings());
$('btn-webstore').addEventListener('click', () => bro.newTab('https://chromewebstore.google.com/'));
$('btn-zoom').addEventListener('click', () => bro.runCommand('page.zoomReset'));
$('btn-profile').addEventListener('click', () => bro.showProfileMenu());
$('btn-downloads').addEventListener('click', () => bro.runCommand('app.downloads'));

const bookmarkBtn = $<HTMLButtonElement>('btn-bookmark');
bookmarkBtn.addEventListener('click', () => {
  if (activeTab && activeTab.url) bro.toggleBookmark(activeTab.url, activeTab.title);
});

// --- Omnibox ---------------------------------------------------------------
const omnibox = $<HTMLInputElement>('omnibox');
let omniboxEditing = false;
omnibox.addEventListener('focus', () => {
  omniboxEditing = true;
  omnibox.select();
});
omnibox.addEventListener('blur', () => (omniboxEditing = false));
omnibox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    bro.navigate(omnibox.value);
    omnibox.blur();
  } else if (e.key === 'Escape') {
    omnibox.value = activeTab?.url ?? '';
    omnibox.blur();
  }
});

bro.onFocusOmnibox(() => {
  omnibox.focus();
  omnibox.select();
});

function renderSearch(cfg: SearchConfig): void {
  const def = cfg.engines.find((e) => e.keyword === cfg.defaultKeyword);
  omnibox.placeholder = `Search ${def?.name ?? 'the web'} or type a URL`;
}
bro.onSearchChanged(renderSearch);
void bro.getSearch().then(renderSearch);

// --- Find in page ----------------------------------------------------------
const findbar = $('findbar');
const findInput = $<HTMLInputElement>('find-input');
const findCount = $('find-count');

function openFind(): void {
  findbar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) bro.findInPage({ text: findInput.value, forward: true, newSession: true });
}

function closeFind(): void {
  if (findbar.hidden) return;
  findbar.hidden = true;
  findCount.textContent = '';
  bro.stopFind();
}

function findStep(forward: boolean): void {
  if (findInput.value) bro.findInPage({ text: findInput.value, forward, newSession: false });
}

findInput.addEventListener('input', () => {
  bro.findInPage({ text: findInput.value, forward: true, newSession: true });
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    findStep(!e.shiftKey);
  } else if (e.key === 'Escape') {
    closeFind();
  }
});
$('find-next').addEventListener('click', () => findStep(true));
$('find-prev').addEventListener('click', () => findStep(false));
$('find-close').addEventListener('click', closeFind);

bro.onFindShow(openFind);
bro.onFindResult((r) => {
  findCount.textContent = !findInput.value ? '' : r.total ? `${r.active}/${r.total}` : 'No results';
  findCount.classList.toggle('none', !!findInput.value && !r.total);
});

// --- Tab strip + state sync ------------------------------------------------
const tabsEl = $('tabs');
const back = $<HTMLButtonElement>('btn-back');
const forward = $<HTMLButtonElement>('btn-forward');
const zoomBtn = $<HTMLButtonElement>('btn-zoom');
let activeTab: TabState | undefined;
let profiles: ProfilesState | null = null;
let lastTabs: TabState[] = [];

function render(tabs: TabState[]): void {
  lastTabs = tabs;
  const multi = !!profiles && profiles.profiles.length > 1;
  // Tabs
  tabsEl.replaceChildren();
  for (const t of tabs) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (t.active ? ' active' : '') + (t.sleeping ? ' sleeping' : '') + (t.private ? ' private' : '');
    const prof = profiles?.profiles.find((p) => p.id === t.profileId);
    tab.title = (t.private ? '[Private] ' : multi && prof ? `[${prof.name}] ` : '') + (t.url || t.title);
    if (multi && prof && !t.private) {
      tab.classList.add('profiled');
      tab.style.setProperty('--profile', prof.color);
    }

    if (t.favicon) {
      const img = document.createElement('img');
      img.className = 'favicon';
      img.src = t.favicon;
      img.onerror = () => img.remove();
      tab.appendChild(img);
    } else {
      const dot = document.createElement('span');
      dot.className = t.loading ? 'spinner' : 'favicon-placeholder';
      tab.appendChild(dot);
    }

    const label = document.createElement('span');
    label.className = 'tab-title';
    label.textContent = t.title;
    tab.appendChild(label);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.title = 'Close tab';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      bro.closeTab(t.id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => bro.activateTab(t.id));
    // Middle-click closes the tab (Chrome behaviour). mousedown preventDefault
    // suppresses the middle-click autoscroll cursor.
    tab.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        bro.closeTab(t.id);
      }
    });
    tabsEl.appendChild(tab);
  }

  // Toolbar reflects the active tab.
  const prevId = activeTab?.id;
  activeTab = tabs.find((t) => t.active);
  if (activeTab) {
    // Switching tabs ends the search (its matches belong to the old page).
    if (prevId !== undefined && prevId !== activeTab.id) closeFind();
    if (!omniboxEditing) omnibox.value = activeTab.url;
    // Private look + no extension buttons (extensions can't see private tabs).
    document.body.classList.toggle('private-active', activeTab.private);
    $('private-badge').hidden = !activeTab.private;
    // Extension buttons belong to the active tab's profile.
    const actions = $('actions');
    if (activeTab.partition && !activeTab.private) actions.setAttribute('partition', activeTab.partition);
    else actions.removeAttribute('partition');
    back.disabled = !activeTab.canGoBack;
    forward.disabled = !activeTab.canGoForward;
    const canBookmark = !!activeTab.url;
    bookmarkBtn.disabled = !canBookmark;
    bookmarkBtn.textContent = activeTab.bookmarked ? '★' : '☆'; // filled vs outline star
    bookmarkBtn.classList.toggle('on', activeTab.bookmarked);
    const zoom = Math.round(activeTab.zoom * 100);
    zoomBtn.hidden = zoom === 100;
    omnibox.classList.toggle('zoomed', zoom !== 100); // room for the badge
    zoomBtn.textContent = `${zoom}%`;
  }
}

bro.onTabsChanged(render);

// --- Profiles ---------------------------------------------------------------
function renderProfiles(s: ProfilesState): void {
  profiles = s;
  const p = s.profiles.find((x) => x.id === s.current) ?? s.profiles[0];
  const btn = $('btn-profile');
  btn.textContent = (p?.name.trim()[0] ?? 'P').toUpperCase();
  btn.style.background = p?.color ?? '';
  btn.title = `Profile: ${p?.name ?? ''} — switch, add or manage profiles`;
  render(lastTabs); // stripes depend on how many profiles exist
}
bro.onProfilesChanged(renderProfiles);
void bro.getProfiles().then(renderProfiles);

// --- Downloads button ---------------------------------------------------------
let knownDownloads = new Set<string>();
function renderDownloads(list: DownloadInfo[]): void {
  const btn = $('btn-downloads');
  btn.hidden = list.length === 0;
  const active = list.filter((d) => d.status === 'downloading');
  const badge = $('dl-badge');
  badge.hidden = active.length === 0;
  badge.textContent = String(active.length);
  const total = active.reduce((a, d) => a + Math.max(0, d.total), 0);
  const got = active.reduce((a, d) => a + d.received, 0);
  const bar = $('dl-progress');
  bar.hidden = active.length === 0 || total <= 0;
  bar.style.width = total > 0 ? `${Math.min(100, (got / total) * 100)}%` : '0';
  // A new download started: draw the eye to the button.
  const fresh = list.some((d) => !knownDownloads.has(d.id));
  if (fresh && knownDownloads.size + list.length > 0 && btn.dataset.ready) {
    btn.classList.remove('pulse');
    void btn.offsetWidth;
    btn.classList.add('pulse');
  }
  knownDownloads = new Set(list.map((d) => d.id));
  btn.dataset.ready = '1';
}
bro.onDownloadsChanged(renderDownloads);
void bro.getDownloads().then(renderDownloads);
void bro.listTabs().then(render);

// --- Adblock shield counter ------------------------------------------------
const shieldCount = $('shield-count');
function renderShield(stats: { enabled: boolean; blocked: number }): void {
  shieldCount.textContent = String(stats.blocked);
  $('shield').classList.toggle('off', !stats.enabled);
}
bro.onAdblockStatsChanged(renderShield);
void bro.getAdblockStats().then(renderShield);
