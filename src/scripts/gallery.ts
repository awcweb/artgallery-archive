// Client-side search and filtering for the home gallery.
// Every card is already in the HTML (so the page works without JavaScript); this script
// shows and hides cards using a small JSON index and keeps the filters in the URL
// (?q=&category=&year=) so views can be shared, bookmarked and navigated with Back.

import type { IndexEntry } from '../pages/search-index.json';

interface Filters {
  q: string;
  category: string;
  year: string;
}

const normalize = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

function readUrl(): Filters {
  const params = new URLSearchParams(location.search);
  return {
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    year: params.get('year') ?? '',
  };
}

function toQuery(f: Filters): string {
  const params = new URLSearchParams();
  if (f.q.trim()) params.set('q', f.q.trim());
  if (f.category) params.set('category', f.category);
  if (f.year) params.set('year', f.year);
  const qs = params.toString();
  return qs ? `?${qs}` : location.pathname;
}

export async function initGallery() {
  const form = document.getElementById('filters') as HTMLFormElement;
  const q = document.getElementById('q') as HTMLInputElement;
  const category = document.getElementById('category') as HTMLSelectElement;
  const year = document.getElementById('year') as HTMLSelectElement;
  const count = document.getElementById('result-count') as HTMLElement;
  const empty = document.getElementById('no-results') as HTMLElement;
  const cards = new Map<string, HTMLElement>();
  for (const li of document.querySelectorAll<HTMLElement>('#gallery > li[data-id]')) {
    cards.set(li.dataset.id!, li);
  }

  let index: (IndexEntry & { n: string })[];
  try {
    const res = await fetch(form.dataset.index!);
    if (!res.ok) throw new Error(String(res.status));
    index = ((await res.json()) as IndexEntry[]).map((e) => ({ ...e, n: normalize(e.s) }));
  } catch {
    // Without the index the full gallery stays visible and the browse links still work.
    return;
  }

  // Only offer values that exist, so a hand-edited URL can't select a missing option.
  const valid = (select: HTMLSelectElement, value: string) =>
    [...select.options].some((o) => o.value === value) ? value : '';

  const setControls = (f: Filters) => {
    q.value = f.q;
    category.value = valid(category, f.category);
    year.value = valid(year, f.year);
  };

  const current = (): Filters => ({ q: q.value, category: category.value, year: year.value });

  const apply = () => {
    const f = current();
    const terms = normalize(f.q).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const entry of index) {
      const match =
        (!f.category || entry.c === f.category) &&
        (!f.year || entry.y === f.year) &&
        terms.every((t) => entry.n.includes(t));
      const card = cards.get(entry.i);
      if (card) card.hidden = !match;
      if (match) shown++;
    }
    const total = index.length.toLocaleString('en-US');
    const filtered = Boolean(terms.length || f.category || f.year);
    count.textContent = filtered
      ? `Showing ${shown.toLocaleString('en-US')} of ${total} works`
      : `Showing all ${total} works`;
    empty.hidden = shown > 0;
  };

  // Typing replaces the current history entry; choosing a filter adds one, so Back undoes it.
  const commit = (mode: 'push' | 'replace') => {
    const target = toQuery(current());
    const now = location.search || location.pathname;
    if (target !== now) history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', target);
    apply();
  };

  let typing: number | undefined;
  q.addEventListener('input', () => {
    clearTimeout(typing);
    typing = window.setTimeout(() => commit('replace'), 200);
  });
  category.addEventListener('change', () => commit('push'));
  year.addEventListener('change', () => commit('push'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(typing);
    commit('push');
  });
  form.addEventListener('reset', (e) => {
    e.preventDefault();
    setControls({ q: '', category: '', year: '' });
    commit('push');
    q.focus();
  });
  window.addEventListener('popstate', () => {
    setControls(readUrl());
    apply();
  });

  setControls(readUrl());
  form.hidden = false;
  apply();
}
