// Settings page (its own overlay view): privacy + appearance switches, startup,
// search engines, the keyboard-shortcut editor and data import/export. Uses
// the privileged `window.bro` bridge.
import { PROFILE_COLORS, type AdblockStats, type Prefs, type ProfilesState, type SearchConfig, type SearchEngine, type VideoToolsState } from '../shared/ipc-contract';
import { codeToKey, formatAccel, isValidBinding, toAccelerator } from '../shared/keys';
import { DEFAULT_SEARCH, engineProblem } from '../shared/search';
import {
  COMMANDS,
  DEFAULT_MASTER_KEYS,
  MASTER_ID,
  SHORTCUT_GROUPS,
  findOwner,
  groupActive,
  keysFor,
  type CommandId,
  type CustomShortcut,
  type ShortcutGroupId,
  type ShortcutsState,
} from '../shared/shortcuts';

const bro = window.bro;
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** Tiny DOM builder: h('div', { className: 'x', onclick }, child, 'text'). */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {},
  ...children: (Node | string | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) if (c) el.append(c);
  return el;
}

const isMac = bro.platform === 'darwin';
document.body.classList.add(isMac ? 'is-mac' : 'is-win');

function flash(el: HTMLElement, text: string, kind: 'ok' | 'err' = 'ok'): void {
  el.textContent = text;
  el.classList.toggle('err', kind === 'err');
}

$('close').addEventListener('click', () => bro.closeSettings());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') bro.closeSettings();
});

// --- Screen-share invisibility --------------------------------------------
const pill = $('capture-pill');
const captureText = $('capture-text');
const captureDetail = $('capture-detail');

function renderCapture(hidden: boolean): void {
  pill.setAttribute('aria-checked', String(hidden));
  captureText.textContent = hidden ? 'ON' : 'OFF';
  captureDetail.textContent = hidden
    ? isMac
      ? 'NSWindowSharingNone — excluded from macOS capture'
      : 'WDA_EXCLUDEFROMCAPTURE — excluded from Windows capture'
    : 'Currently visible to screen share';
}

pill.addEventListener('click', () => {
  bro.setCaptureHidden(pill.getAttribute('aria-checked') !== 'true');
});
bro.onCaptureHiddenChanged(renderCapture);

// --- Adblock ---------------------------------------------------------------
const adPill = $('adblock-pill');
const adText = $('adblock-text');
const adDetail = $('adblock-detail');
const adReload = $<HTMLButtonElement>('adblock-reload');

function renderAdblock(s: AdblockStats): void {
  adPill.setAttribute('aria-checked', String(s.enabled));
  adText.textContent = s.enabled ? 'ON' : 'OFF';
  adReload.hidden = !(s.error && !s.loading);

  if (s.loading) {
    adDetail.textContent = 'Downloading filter lists…';
    adDetail.classList.remove('err');
  } else if (s.error) {
    adDetail.textContent = `Couldn't load lists: ${s.error}. Check your network/proxy, then Retry.`;
    adDetail.classList.add('err');
  } else if (!s.ready) {
    adDetail.textContent = 'Filter lists not loaded yet.';
    adDetail.classList.remove('err');
  } else {
    adDetail.classList.remove('err');
    adDetail.textContent = s.enabled
      ? `${s.blocked.toLocaleString()} blocked this session (EasyList, uBlock filters, trackers + YouTube ad shield)`
      : 'Blocking is off';
  }
}

adPill.addEventListener('click', () => {
  bro.setAdblockEnabled(adPill.getAttribute('aria-checked') !== 'true');
});
adReload.addEventListener('click', () => bro.reloadAdblock());
bro.onAdblockStatsChanged(renderAdblock);
void bro.getAdblockStats().then(renderAdblock);

// --- Opacity ---------------------------------------------------------------
const slider = $<HTMLInputElement>('opacity');
const opacityVal = $('opacity-val');

function renderOpacity(v: number): void {
  slider.value = String(v);
  opacityVal.textContent = `${Math.round(v * 100)}%`;
}

slider.addEventListener('input', () => bro.setOpacity(parseFloat(slider.value)));
bro.onOpacityChanged(renderOpacity);

// --- Overlay mode ----------------------------------------------------------
const overlayPill = $('overlay-pill');
const overlayText = $('overlay-text');

function renderOverlay(on: boolean): void {
  overlayPill.setAttribute('aria-checked', String(on));
  overlayText.textContent = on ? 'ON' : 'OFF';
}

overlayPill.addEventListener('click', () => {
  bro.setOverlayMode(overlayPill.getAttribute('aria-checked') !== 'true');
});
bro.onOverlayModeChanged(renderOverlay);

// --- On startup ------------------------------------------------------------
const startupRadios = document.querySelectorAll<HTMLInputElement>('input[name="startup"]');
function renderPrefs(p: Prefs): void {
  startupRadios.forEach((r) => (r.checked = r.value === p.startup));
  $('dl-dir').textContent = p.downloadDir || 'Your Downloads folder';
  $('dl-dir-reset').hidden = !p.downloadDir;
  $('dl-ask').setAttribute('aria-checked', String(p.askWhereToSave));
  $('dl-ask-text').textContent = p.askWhereToSave ? 'ON' : 'OFF';
  $<HTMLInputElement>('dl-conn').value = String(p.downloadConnections);
  $('dl-conn-val').textContent = String(p.downloadConnections);
  $<HTMLSelectElement>('vid-quality').value = String(p.videoQuality);
  $('vid-subs').setAttribute('aria-checked', String(p.videoSubtitles));
  $('vid-subs-text').textContent = p.videoSubtitles ? 'ON' : 'OFF';
}
$('vid-quality').addEventListener('change', () => bro.setPrefs({ videoQuality: Number($<HTMLSelectElement>('vid-quality').value) }));
$('vid-subs').addEventListener('click', () =>
  bro.setPrefs({ videoSubtitles: $('vid-subs').getAttribute('aria-checked') !== 'true' }),
);

// --- Video tools (yt-dlp + ffmpeg) --------------------------------------------
function renderVideoTools(s: VideoToolsState): void {
  const btn = $<HTMLButtonElement>('vt-install');
  const detail = $('vt-detail');
  btn.disabled = s.installing;
  btn.textContent = s.installing ? `Downloading… ${Math.round(s.progress * 100)}%` : s.ready ? 'Update' : 'Download now';
  btn.title = s.ready ? 'Get the newest yt-dlp — do this when a site stops working' : '';
  detail.textContent = s.error
    ? `Couldn’t get the tools: ${s.error}`
    : s.ready
      ? `Installed${s.ytdlpVersion ? ` (yt-dlp ${s.ytdlpVersion})` : ''}. If a site stops working, press Update — sites change and yt-dlp follows them.`
      : 'yt-dlp finds the video on thousands of sites; ffmpeg turns any format into one that plays. About 50 MB, fetched once (or on your first video save).';
  detail.classList.toggle('err', !!s.error);
}
$('vt-install').addEventListener('click', () => bro.installVideoTools());
bro.onVideoToolsChanged(renderVideoTools);
void bro.getVideoTools().then(renderVideoTools);
$('dl-dir-change').addEventListener('click', async () => {
  const dir = await bro.chooseDownloadDir();
  if (dir) bro.setPrefs({ downloadDir: dir });
});
$('dl-dir-reset').addEventListener('click', () => bro.setPrefs({ downloadDir: '' }));
$('dl-ask').addEventListener('click', () =>
  bro.setPrefs({ askWhereToSave: $('dl-ask').getAttribute('aria-checked') !== 'true' }),
);
const connSlider = $<HTMLInputElement>('dl-conn');
connSlider.addEventListener('input', () => ($('dl-conn-val').textContent = connSlider.value));
connSlider.addEventListener('change', () => bro.setPrefs({ downloadConnections: Number(connSlider.value) }));
startupRadios.forEach((r) =>
  r.addEventListener('change', () => {
    if (r.checked) bro.setPrefs({ startup: r.value as Prefs['startup'] });
  }),
);
bro.onPrefsChanged(renderPrefs);
void bro.getPrefs().then(renderPrefs);

// --- Search engines --------------------------------------------------------
const searchDefault = $<HTMLSelectElement>('search-default');
const engineTable = $('engine-table');
const searchMsg = $('search-msg');
let search: SearchConfig = DEFAULT_SEARCH;
/** The config we last sent — its echo needn't re-render (that would steal focus mid-edit). */
let sentSearch = '';

function sendSearch(next: SearchConfig): void {
  search = next;
  sentSearch = JSON.stringify(next);
  bro.setSearch(next);
}

function renderSearch(cfg: SearchConfig): void {
  search = cfg;
  searchDefault.replaceChildren(
    ...cfg.engines.map((e) =>
      h('option', { value: e.keyword, selected: e.keyword === cfg.defaultKeyword }, `${e.name} (${e.keyword})`),
    ),
  );
  engineTable.replaceChildren(
    h('div', { className: 'engine-row engine-head' }, h('span', {}, 'Keyword'), h('span', {}, 'Name'), h('span', {}, 'URL'), h('span')),
    ...cfg.engines.map((e, i) => engineRow(e, i)),
  );
}

function engineRow(e: SearchEngine, i: number): HTMLElement {
  const kw = h('input', { className: 'field kw', value: e.keyword, spellcheck: false });
  const nm = h('input', { className: 'field nm', value: e.name, spellcheck: false });
  const url = h('input', { className: 'field url', value: e.url, spellcheck: false, title: e.url });
  const commit = () => {
    const problem =
      engineProblem(kw.value, url.value) ??
      (search.engines.some((o, j) => j !== i && o.keyword.toLowerCase() === kw.value.trim().toLowerCase())
        ? `Keyword “${kw.value.trim()}” is already used`
        : null);
    row.classList.toggle('invalid', !!problem);
    if (problem) return flash(searchMsg, problem, 'err');
    flash(searchMsg, '');
    const engines = search.engines.map((o, j) =>
      j === i ? { keyword: kw.value.trim(), name: nm.value.trim() || kw.value.trim(), url: url.value.trim() } : o,
    );
    const defaultKeyword = search.defaultKeyword === e.keyword ? kw.value.trim() : search.defaultKeyword;
    sendSearch({ engines, defaultKeyword });
  };
  for (const f of [kw, nm, url]) f.addEventListener('change', commit);
  const del = h('button', {
    className: 'lib-item-del',
    textContent: '✕',
    title: `Remove ${e.name}`,
    disabled: search.engines.length <= 1,
    onclick: () => sendSearch({ ...search, engines: search.engines.filter((_, j) => j !== i) }),
  });
  const row = h('div', { className: 'engine-row' }, kw, nm, url, del);
  return row;
}

searchDefault.addEventListener('change', () => sendSearch({ ...search, defaultKeyword: searchDefault.value }));

$<HTMLFormElement>('engine-add').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const kw = $<HTMLInputElement>('add-kw');
  const nm = $<HTMLInputElement>('add-name');
  const url = $<HTMLInputElement>('add-url');
  const keyword = kw.value.trim().replace(/^!/, '');
  const problem =
    engineProblem(keyword, url.value) ??
    (search.engines.some((o) => o.keyword.toLowerCase() === keyword.toLowerCase())
      ? `Keyword “${keyword}” is already used`
      : null);
  if (problem) return flash(searchMsg, problem, 'err');
  sendSearch({
    ...search,
    engines: [...search.engines, { keyword, name: nm.value.trim() || keyword, url: url.value.trim() }],
  });
  flash(searchMsg, `Added — try “${keyword} something” in the address bar.`);
  kw.value = nm.value = url.value = '';
  renderSearch(search);
});

$('search-reset').addEventListener('click', () => {
  if (!confirm('Replace your search engines with the built-in list?')) return;
  sendSearch(structuredClone(DEFAULT_SEARCH));
  renderSearch(search);
  flash(searchMsg, 'Default search engines restored.');
});

bro.onSearchChanged((cfg) => {
  const json = JSON.stringify(cfg);
  if (json === sentSearch) {
    search = cfg;
    return;
  }
  renderSearch(cfg);
});
void bro.getSearch().then(renderSearch);

// --- Keyboard shortcuts ----------------------------------------------------
const scMsg = $('sc-msg');
const scFailed = $('sc-failed');
const scMaster = $('sc-master');
const scGroups = $('sc-groups');
let sc: ShortcutsState | null = null;
/** Binding id currently capturing a key press, if any. */
let recordingId: string | null = null;

const labelFor = (id: string): string =>
  id === MASTER_ID
    ? 'Master switch'
    : (COMMANDS.find((c) => c.id === id)?.label ?? sc?.config.custom.find((c) => c.id === id)?.label ?? id);

function startRecording(id: string): void {
  recordingId = id;
  bro.setShortcutRecording(true); // suspend every hotkey so the combo reaches us
  flash(scMsg, `Press the new keys for “${labelFor(id)}” — Esc to cancel.`);
  renderShortcuts();
}

function stopRecording(): void {
  if (recordingId === null) return;
  recordingId = null;
  bro.setShortcutRecording(false);
  renderShortcuts();
}

// Capture phase on window: runs before the Esc-closes-Settings handler.
window.addEventListener(
  'keydown',
  (e) => {
    if (recordingId === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if (e.key === 'Escape' && plain) {
      flash(scMsg, '');
      return stopRecording();
    }
    const key = codeToKey(e.code);
    if (!key) return; // a lone modifier — keep waiting for the real key
    const accel = toAccelerator({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }, key, isMac);
    if (!isValidBinding(accel, isMac)) {
      flash(scMsg, `${formatAccel(accel, isMac)} would fire while typing — add Ctrl, Alt or ${isMac ? 'Cmd' : 'Win'}.`, 'err');
      return;
    }
    const id = recordingId;
    const cfg = sc!.config;
    const owner = findOwner(cfg, accel, isMac, id);
    bro.setShortcutKeys(id, [...keysFor(cfg, id), accel]);
    flash(
      scMsg,
      owner
        ? `${formatAccel(accel, isMac)} now does “${labelFor(id)}” (moved from “${owner.label}”).`
        : `${formatAccel(accel, isMac)} → “${labelFor(id)}”.`,
    );
    stopRecording();
  },
  true,
);
// Clicking away / closing Settings ends a capture.
window.addEventListener('blur', () => {
  if (recordingId !== null) flash(scMsg, '');
  stopRecording();
});

/** Key chips (removable) + "+" to add + optional reset, for one binding id. */
function keyCell(id: string, opts: { resettable?: boolean } = {}): HTMLElement {
  const keys = sc ? keysFor(sc.config, id) : [];
  const failed = new Set(sc?.failed ?? []);
  const chips = keys.map((k) =>
    h(
      'span',
      { className: 'chip' + (failed.has(k) ? ' failed' : ''), title: failed.has(k) ? 'Taken by another app' : '' },
      formatAccel(k, isMac),
      h('button', {
        className: 'chip-x',
        textContent: '✕',
        title: 'Remove this key',
        onclick: () => bro.setShortcutKeys(id, keys.filter((x) => x !== k)),
      }),
    ),
  );
  const rec = recordingId === id;
  return h(
    'div',
    { className: 'keys' },
    ...chips,
    rec ? h('span', { className: 'chip recording' }, 'Press keys…') : null,
    h('button', {
      className: 'chip-add',
      textContent: rec ? 'Cancel' : '+',
      title: rec ? 'Stop recording' : 'Add a key',
      onclick: () => (rec ? stopRecording() : startRecording(id)),
    }),
    opts.resettable
      ? h('button', { className: 'chip-add', textContent: '↺', title: 'Reset to default', onclick: () => bro.resetShortcuts(id) })
      : null,
  );
}

function switchPill(on: boolean, onText: string, offText: string, toggle: () => void): HTMLButtonElement {
  const b = h(
    'button',
    { className: 'pill small', onclick: toggle },
    h('span', { className: 'dot' }),
    h('span', {}, on ? onText : offText),
  );
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  return b;
}

function renderShortcuts(): void {
  if (!sc) return;
  const cfg = sc.config;

  // Keys other apps already own.
  scFailed.hidden = sc.failed.length === 0;
  scFailed.textContent = sc.failed.length
    ? `Another app already uses ${sc.failed.map((k) => formatAccel(k, isMac)).join(', ')}, so ${
        sc.failed.length === 1 ? 'it doesn’t' : 'they don’t'
      } work system-wide. Pick different keys below (marked in red).`
    : '';

  // Master switch.
  const targets = new Set(cfg.master.targets);
  scMaster.replaceChildren(
    h(
      'div',
      { className: 'sc-group master' + (cfg.master.active ? ' cut' : '') },
      h(
        'div',
        { className: 'sc-group-head' },
        h(
          'div',
          { className: 'row-label' },
          h('strong', {}, 'Master switch'),
          h(
            'small',
            {},
            cfg.master.active
              ? 'Cutting off the groups ticked below — press the master key again to bring them back.'
              : 'Press it to cut off the groups ticked below in one go (e.g. hand Ctrl+Shift+H back to Teams). Always system-wide; never cut off itself.',
          ),
        ),
        switchPill(cfg.master.active, 'CUT OFF', 'LIVE', () => bro.toggleMaster()),
      ),
      h(
        'div',
        { className: 'sc-row' },
        h('span', { className: 'sc-label' }, 'Master key'),
        keyCell(MASTER_ID, {
          resettable: JSON.stringify(cfg.master.keys) !== JSON.stringify(DEFAULT_MASTER_KEYS),
        }),
      ),
      h(
        'div',
        { className: 'sc-targets' },
        h('span', { className: 'sc-label' }, 'Cuts off'),
        ...SHORTCUT_GROUPS.map((g) => {
          const box = h('input', { type: 'checkbox', checked: targets.has(g.id) });
          box.addEventListener('change', () => {
            const next = new Set(targets);
            if (box.checked) next.add(g.id);
            else next.delete(g.id);
            bro.setMasterTargets([...next]);
          });
          return h('label', { className: 'check' }, box, g.name);
        }),
      ),
    ),
  );

  // Groups.
  scGroups.replaceChildren(
    ...SHORTCUT_GROUPS.map((g) => {
      const enabled = cfg.groupEnabled[g.id] !== false;
      const live = groupActive(cfg, g.id);
      const head = h(
        'div',
        { className: 'sc-group-head' },
        h(
          'div',
          { className: 'row-label' },
          h('strong', {}, g.name, g.global ? h('span', { className: 'badge' }, 'System-wide') : null),
          h('small', {}, enabled && !live ? `${g.description} (Cut off by the master switch.)` : g.description),
        ),
        switchPill(enabled, 'ON', 'OFF', () => bro.setGroupEnabled(g.id, !enabled)),
      );
      const body = g.id === 'custom' ? customRows(cfg.custom) : commandRows(g.id);
      return h('div', { className: 'sc-group' + (live ? '' : ' off') }, head, ...body);
    }),
  );

  // Inline key hints elsewhere on the page.
  document.querySelectorAll<HTMLElement>('.kbd-for').forEach((el) => {
    const k = keysFor(cfg, el.dataset.cmd as CommandId)[0];
    el.replaceChildren(k ? h('kbd', {}, formatAccel(k, isMac)) : 'its shortcut (none set)');
  });
}

function commandRows(group: ShortcutGroupId): HTMLElement[] {
  const cfg = sc!.config;
  return COMMANDS.filter((c) => c.group === group).map((c) =>
    h(
      'div',
      { className: 'sc-row' },
      h('span', { className: 'sc-label' }, c.label),
      keyCell(c.id, { resettable: c.id in cfg.overrides }),
    ),
  );
}

function customRows(list: CustomShortcut[]): HTMLElement[] {
  const rows = list.map((s) => {
    const save = (patch: Partial<CustomShortcut>) => bro.saveCustomShortcut({ ...s, ...patch });
    const label = h('input', { className: 'field', value: s.label, spellcheck: false, placeholder: 'Label' });
    label.addEventListener('change', () => save({ label: label.value }));
    const target = h('input', { className: 'field', value: s.target, spellcheck: false, placeholder: 'yt lofi  or  github.com' });
    target.addEventListener('change', () => {
      if (target.value.trim()) save({ target: target.value });
    });
    const global = h('input', { type: 'checkbox', checked: s.global });
    global.addEventListener('change', () => save({ global: global.checked }));
    const newTab = h('input', { type: 'checkbox', checked: s.newTab });
    newTab.addEventListener('change', () => save({ newTab: newTab.checked }));
    return h(
      'div',
      { className: 'sc-custom' },
      h('div', { className: 'sc-custom-fields' }, label, target),
      keyCell(s.id),
      h(
        'div',
        { className: 'sc-custom-opts' },
        h('label', { className: 'check' }, global, 'System-wide'),
        h('label', { className: 'check' }, newTab, 'New tab'),
        h('button', { className: 'text-btn', textContent: 'Delete', onclick: () => bro.removeCustomShortcut(s.id) }),
      ),
    );
  });

  const label = h('input', { className: 'field', placeholder: 'Label (optional)', spellcheck: false });
  const target = h('input', { className: 'field', placeholder: 'What to open: yt lofi, github.com, …', spellcheck: false });
  const add = h(
    'form',
    {
      className: 'sc-custom-add',
      autocomplete: 'off',
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        if (!target.value.trim()) return flash(scMsg, 'Type what the shortcut should open first.', 'err');
        bro.saveCustomShortcut({ id: '', label: label.value, target: target.value, keys: [], global: false, newTab: true });
        flash(scMsg, 'Added — now click + on it to give it keys.');
      },
    },
    label,
    target,
    h('button', { type: 'submit', className: 'text-btn accent', textContent: 'Add shortcut' }),
  );
  return [...rows, add];
}

$('sc-reset-all').addEventListener('click', () => {
  if (!confirm('Reset every shortcut, group switch and the master switch to defaults? Your own shortcuts are kept.')) return;
  bro.resetShortcuts();
  flash(scMsg, 'All shortcuts reset to defaults.');
});

bro.onShortcutsChanged((s) => {
  sc = s;
  renderShortcuts();
});
void bro.getShortcuts().then((s) => {
  sc = s;
  renderShortcuts();
});

// --- Profiles --------------------------------------------------------------
const profileList = $('profile-list');
const profileMsg = $('profile-msg');
let profileState: ProfilesState | null = null;

function renderProfilesSection(s: ProfilesState): void {
  profileState = s;
  const current = s.profiles.find((p) => p.id === s.current);
  $('clear-scope').textContent = s.profiles.length > 1 && current ? `Applies to the ${current.name} profile.` : '';
  // Don't rebuild while a name is being typed.
  if (profileList.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
  profileList.replaceChildren(
    ...s.profiles.map((p) => {
      const name = h('input', { className: 'field', value: p.name, spellcheck: false, maxLength: 40 });
      name.addEventListener('change', () => bro.updateProfile(p.id, { name: name.value }));
      const swatches = h(
        'div',
        { className: 'swatches' },
        ...PROFILE_COLORS.map((c) => {
          const b = h('button', {
            className: 'swatch' + (c === p.color ? ' on' : ''),
            title: 'Profile colour',
            onclick: () => bro.updateProfile(p.id, { color: c }),
          });
          b.style.background = c;
          return b;
        }),
      );
      const open = h('button', { className: 'text-btn', textContent: 'New tab', onclick: () => bro.newTabInProfile(p.id) });
      const del =
        p.id === 'default'
          ? h('span', { className: 'profile-tag', textContent: 'original profile' })
          : h('button', {
              className: 'text-btn',
              textContent: 'Delete',
              onclick: async () => {
                if (!confirm(`Delete the ${p.name} profile? Its tabs close and its sign-ins, cookies, history, bookmarks and extensions are erased. Downloaded files stay.`)) return;
                const ok = await bro.removeProfile(p.id);
                flash(profileMsg, ok ? `${p.name} deleted.` : 'Couldn’t delete that profile.', ok ? 'ok' : 'err');
              },
            });
      return h('div', { className: 'profile-row' + (p.id === s.current ? ' current' : '') }, swatches, name, open, del);
    }),
  );
}

$<HTMLFormElement>('profile-add').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $<HTMLInputElement>('profile-name');
  const name = input.value.trim();
  if (!name) return flash(profileMsg, 'Give the profile a name first.', 'err');
  const used = new Set(profileState?.profiles.map((p) => p.color));
  const color = PROFILE_COLORS.find((c) => !used.has(c)) ?? PROFILE_COLORS[0];
  await bro.createProfile(name, color);
  input.value = '';
  flash(profileMsg, `${name} created — a tab in it is open. Sign in there to keep it separate.`);
});

bro.onProfilesChanged(renderProfilesSection);
void bro.getProfiles().then(renderProfilesSection);

// --- Your data -------------------------------------------------------------
const dataMsg = $('data-msg');

$('data-export').addEventListener('click', async () => {
  const path = await bro.exportData();
  if (path) flash(dataMsg, `Saved to ${path}`);
});
$('data-import').addEventListener('click', async () => {
  const summary = await bro.importData();
  if (summary) flash(dataMsg, summary, summary.startsWith('Imported') ? 'ok' : 'err');
});
$('clear-history').addEventListener('click', () => {
  if (!confirm('Delete all browsing history?')) return;
  bro.clearHistory();
  flash(dataMsg, 'History cleared.');
});
$('clear-cookies').addEventListener('click', async () => {
  if (!confirm('Delete all cookies? You will be signed out of websites.')) return;
  await bro.clearCookies();
  flash(dataMsg, 'Cookies cleared.');
});
$('clear-cache').addEventListener('click', async () => {
  await bro.clearCache();
  flash(dataMsg, 'Cache cleared.');
});
void bro.getDataDir().then((d) => ($('data-dir').textContent = d));

// --- Pull current state ----------------------------------------------------
void bro.getCaptureHidden().then(renderCapture);
void bro.getOpacity().then(renderOpacity);
void bro.getOverlayMode().then(renderOverlay);
