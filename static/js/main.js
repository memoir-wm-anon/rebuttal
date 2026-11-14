/*
 * Rebuttal video sets.
 * Each tab loads   `${dir}/${tab.id}/${key}.mp4`   for every [key, label] in `rows`
 * ([key, label, 'jpg'|'png'] shows a still image instead of a video).
 * A missing file just stays as a placeholder, so drop videos in and they appear.
 * A tab can override `rows`, and can set `events: [{ t: seconds, label }]` to mark
 * moments on the shared scrubber (e.g. the chunk boundary).
 * A set can give `aspect` (CSS aspect-ratio for its slots, default 3 / 2), and
 * `native: true` to resize each slot to its video's own aspect once it loads.
 * Keys starting with `ours` are highlighted.
 */
const scenes = (n, prefix = 'scene') =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-0${i + 1}`, label: `Scene ${i + 1}` }));

const SETS = {
  /* 01 Robustness */
  'noisy-boxes': {
    dir: 'videos/robustness/noisy-boxes',
    tabs: scenes(3),
    rows: [
      [['condition', 'Clean Condition'], ['condition-jitter', 'Jittered Boxes (σ = 0.3 m)'], ['condition-dropout', 'Flickering Boxes (30% dropped)']],
      [['ours', 'MemOIR · Clean'], ['ours-jitter', 'MemOIR · Jittered'], ['ours-dropout', 'MemOIR · Flickering']],
    ],
  },
  'id-switch': {
    dir: 'videos/robustness/id-switch',
    tabs: scenes(3),
    rows: [[['condition', 'Condition (new ID on return)'], ['real', 'Real Video'], ['ours', 'MemOIR (Ours)']]],
  },

  /* 02 Instance memory beyond vehicles (Cosmos-Predict2.5, Lyft L5 zero-shot) */
  revisit: {
    dir: 'videos/consistency/revisit',
    tabs: scenes(3),
    rows: [[['condition', 'Condition (Forward → Reverse)'], ['no-memory', 'Memory Off'], ['ours', 'Memory On (Ours)']]],
  },

  /* 03 Memory on another backbone (Wan2.1-VACE) */
  'wan-faces': {
    dir: 'videos/consistency/faces',
    aspect: '1 / 1',
    native: true,
    tabs: scenes(3),
    rows: [[['condition', 'Condition'], ['no-memory', 'Wan2.1-VACE (No Memory)'], ['ours', 'With Instance Memory (Ours)'], ['real', 'Ground Truth']]],
  },
  'wan-pedestrians': {
    dir: 'videos/consistency/walkingtours',
    aspect: '16 / 9',
    native: true,
    tabs: scenes(3),
    rows: [[['condition', 'Condition'], ['no-memory', 'Wan2.1-VACE (No Memory)'], ['ours', 'With Instance Memory (Ours)'], ['real', 'Ground Truth']]],
  },

  /* 04 Zero-shot Lyft L5 */
  'lyft-matched': {
    dir: 'videos/lyft/matched',
    tabs: scenes(3),
    rows: [
      [['condition', 'Blocks-World Condition'], ['real', 'Real Video']],
      [['dreamforge', 'DreamForge'], ['magicdrive-v2', 'MagicDrive-V2'], ['ours', 'MemOIR (Ours)']],
    ],
  },
  'lyft-fullchunk': {
    dir: 'videos/lyft/full-chunk',
    tabs: scenes(3),
    rows: [[['real', 'Real Video'], ['short-ft', 'MemOIR (25-frame fine-tuning)'], ['ours', 'MemOIR (full-chunk fine-tuning)']]],
  },

  /* 05 Blocks world from a single image */
  'single-image': {
    dir: 'videos/single-image/automatic',
    tabs: scenes(3),
    rows: [[['input', 'Input Image', 'jpg'], ['world', 'Constructed Blocks World'], ['ours', 'Generated Video']]],
  },
  'agent-refine': {
    dir: 'videos/single-image/agent',
    tabs: scenes(3),
    rows: [
      [['input', 'Input Image', 'jpg'], ['world-auto', 'Automatic Blocks World']],
      [['world-agent', 'Agent-Refined Blocks World'], ['ours', 'Generated Video']],
    ],
  },
};

/* ---------- helpers ---------- */
function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function placeholder(label, src) {
  const ph = el('div', 'ph');
  const name = el('span', 'ph-label');
  name.textContent = label;
  const path = el('code');
  path.textContent = src;
  ph.append(name, path);
  return ph;
}

function makeVideo(src, onReady) {
  const v = el('video');
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.addEventListener('loadeddata', onReady, { once: true });
  v.src = src;
  return v;
}

function fmt(t) {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ---------- synced playback ---------- */

class SyncGroup {
  constructor(bar) {
    this.videos = [];
    this.playing = true;
    this.rate = 1;
    this.bar = bar;
    this.btn = bar.querySelector('button');
    this.range = bar.querySelector('input');
    this.time = bar.querySelector('.time');
    this.speed = bar.querySelector('select');

    this.btn.addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    this.range.addEventListener('input', () => {
      const m = this.master;
      if (m && isFinite(m.duration)) this.seek((this.range.value / 1000) * m.duration);
    });
    this.speed.addEventListener('change', () => {
      this.rate = Number(this.speed.value);
      this.videos.forEach(v => (v.playbackRate = this.rate));
    });
  }

  get master() {
    return this.videos.find(v => v.readyState >= 2);
  }

  add(v) {
    this.videos.push(v);
    v.playbackRate = this.rate;
    v.addEventListener('loadeddata', () => {
      const m = this.master;
      if (m && m !== v) v.currentTime = m.currentTime;
      if (this.playing && this.visible) v.play().catch(() => {});
    });
    v.addEventListener('timeupdate', () => {
      if (v === this.master) this.tick(v);
    });
  }

  clear() {
    this.videos.forEach(v => v.pause());
    this.videos = [];
  }

  tick(m) {
    if (isFinite(m.duration)) this.range.value = (m.currentTime / m.duration) * 1000;
    this.time.textContent = `${fmt(m.currentTime)} / ${fmt(m.duration)}`;
    for (const v of this.videos) {
      if (v !== m && v.readyState >= 2 && Math.abs(v.currentTime - m.currentTime) > 0.1) {
        v.currentTime = m.currentTime;
      }
    }
  }

  play() {
    this.playing = true;
    this.btn.textContent = '❚❚';
    this.btn.setAttribute('aria-label', 'Pause');
    this.videos.forEach(v => v.readyState >= 2 && v.play().catch(() => {}));
  }

  pause() {
    this.playing = false;
    this.btn.textContent = '▶';
    this.btn.setAttribute('aria-label', 'Play');
    this.videos.forEach(v => v.pause());
  }

  seek(t) {
    this.videos.forEach(v => v.readyState >= 1 && (v.currentTime = t));
  }

  setVisible(visible) {
    this.visible = visible;
    if (!visible) this.videos.forEach(v => v.pause());
    else if (this.playing) this.play();
  }

  setEvents(events = [], duration) {
    const track = this.bar.querySelector('.track');
    track.querySelectorAll('.marker').forEach(n => n.remove());
    if (!duration) return;
    for (const e of events) {
      const mk = el('span', 'marker');
      mk.textContent = e.label;
      mk.style.left = `${(e.t / duration) * 100}%`;
      track.append(mk);
    }
  }
}

function makeSyncBar() {
  const bar = el('div', 'sync');
  bar.innerHTML = `
    <button type="button" aria-label="Pause">❚❚</button>
    <div class="track"><input type="range" min="0" max="1000" value="0" aria-label="Seek"></div>
    <span class="time">0:00 / 0:00</span>
    <select class="speed" aria-label="Playback speed">
      <option value="0.25">0.25×</option>
      <option value="0.5">0.5×</option>
      <option value="1" selected>1×</option>
    </select>`;
  return bar;
}

/* ---------- comparison blocks ---------- */

function buildCompare(root) {
  const set = SETS[root.dataset.set];
  if (!set) return;

  if (set.aspect) root.style.setProperty('--aspect', set.aspect);
  const tabs = el('div', 'tabs', { role: 'tablist' });
  const panels = el('div', 'panels');
  const bar = makeSyncBar();
  const group = new SyncGroup(bar);

  const panelFor = set.tabs.map((tab, i) => {
    const btn = el('button', 'tab', { type: 'button', role: 'tab', 'aria-selected': i === 0 ? 'true' : 'false' });
    btn.textContent = tab.label;
    tabs.append(btn);

    const panel = el('div', 'panel', { role: 'tabpanel' });
    panel.hidden = i !== 0;
    const rows = tab.rows || set.rows;
    const ncol = Math.max(...rows.map(r => r.length));
    for (const row of rows) {
      const r = el('div', 'grid-row');
      r.style.setProperty('--n', ncol);
      r.style.setProperty('--k', row.length);
      for (const [key, label, ext = 'mp4'] of row) {
        const fig = el('figure', 'slot' + (key.startsWith('ours') ? ' is-ours' : '') + ((set.contain || []).includes(key) ? ' is-contain' : ''));
        const src = `${set.dir}/${tab.id}/${key}.${ext}`;
        fig.dataset.src = src;
        fig.dataset.kind = ext === 'mp4' ? 'video' : 'image';
        const media = el('div', 'slot-media');
        media.append(placeholder(label, src));
        const cap = el('figcaption');
        cap.textContent = label;
        fig.append(media, cap);
        r.append(fig);
      }
      panel.append(r);
    }
    panels.append(panel);

    btn.addEventListener('click', () => activate(i));
    return panel;
  });

  function activate(i) {
    [...tabs.children].forEach((b, j) => b.setAttribute('aria-selected', j === i ? 'true' : 'false'));
    panelFor.forEach((p, j) => (p.hidden = j !== i));
    group.clear();
    group.setEvents();

    const tab = set.tabs[i];
    panelFor[i].querySelectorAll('.slot').forEach(fig => {
      if (fig.dataset.kind === 'image') {
        if (!fig.querySelector('img')) {
          const img = new Image();
          img.alt = fig.querySelector('figcaption').textContent;
          img.onload = () => {
            fig.querySelector('.slot-media').prepend(img);
            fig.classList.add('is-loaded');
          };
          img.src = fig.dataset.src;
        }
        return;
      }
      let v = fig.querySelector('video');
      if (!v) {
        v = makeVideo(fig.dataset.src, () => {
          fig.classList.add('is-loaded');
          if (set.native && v.videoWidth) fig.style.setProperty('--aspect', `${v.videoWidth} / ${v.videoHeight}`);
          if (tab.events && v === group.master) group.setEvents(tab.events, v.duration);
        });
        fig.querySelector('.slot-media').prepend(v);
      }
      group.add(v);
    });
    if (group.playing) group.play();
  }

  root.append(tabs, panels, bar);

  // Load the first tab only once the block scrolls near the viewport.
  let started = false;
  new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting && !started) {
        started = true;
        group.visible = true;
        activate(0);
      }
      group.setVisible(e.isIntersecting);
    }
  }, { rootMargin: '200px 0px' }).observe(root);
}

/* ---------- nav: highlight the section in view ---------- */

function buildToc(nav) {
  const links = new Map([...nav.querySelectorAll('a[href^="#"]')].map(a => [a.hash.slice(1), a]));
  const sections = [...links.keys()].map(id => document.getElementById(id)).filter(Boolean);
  const update = () => {
    let current = null;
    for (const s of sections) if (s.getBoundingClientRect().top < window.innerHeight * 0.35) current = s.id;
    links.forEach((a, id) => a.classList.toggle('is-active', id === current));
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

document.querySelectorAll('.toc').forEach(buildToc);
document.querySelectorAll('.compare').forEach(buildCompare);

/* ---------- deep links: keep the #target heading in place while fonts / videos settle ---------- */

function keepAnchor() {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id && document.getElementById(id);
  if (!target) return;
  let active = true;
  const align = () => active && target.scrollIntoView({ behavior: 'instant', block: 'start' });
  const stop = () => { active = false; ro.disconnect(); };
  const ro = new ResizeObserver(align);
  ro.observe(document.body);
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => window.addEventListener(ev, stop, { once: true, passive: true }));
  if (document.fonts) document.fonts.ready.then(align);
  window.addEventListener('load', align, { once: true });
  align();
  setTimeout(stop, 5000);
}
keepAnchor();
window.addEventListener('hashchange', keepAnchor);
