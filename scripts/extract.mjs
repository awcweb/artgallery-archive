#!/usr/bin/env node
// Parses the legacy static site in legacy/ into structured data for the Astro site.
//
// Outputs:
//   src/data/artworks.json      one record per unique artwork image
//   src/data/la-trips.json      LA field-trip photos (shown on their own album page)
//   src/assets/artworks/*       artwork images, renamed to <id>.<ext>
//   src/assets/la-trips/*       LA trip photos, renamed to <id>.<ext>
//   src/data/legacy-text.json  real prose from the legacy site (LA trips intro, symposium notes)
//   scripts/needs-review.csv    records missing title, artist or year, plus flagged ambiguities
//
// Rules (agreed in the Phase 1 audit):
//   - Never invent metadata: anything that can't be read from the HTML or folder path is null.
//   - Category, year and semester come from the folder path (f_14 = Fall 2014, s_07 = Spring 2007).
//   - Artist comes from the detail page <title> (or the caption's first segment).
//   - Captions read "Artist, Title , medium". A trailing segment is a medium only when it
//     matches the media vocabulary. A lone non-medium segment is ambiguous: the artist is
//     kept, title and medium stay null, and the raw caption goes to needs-review.csv.
//   - Byte-identical images are merged into one record; sourcePages lists every page.
//
// Usage: node scripts/extract.mjs

import { createHash } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = path.join(ROOT, 'legacy');
const DATA_DIR = path.join(ROOT, 'src/data');
const ART_DIR = path.join(ROOT, 'src/assets/artworks');
const LA_DIR = path.join(ROOT, 'src/assets/la-trips');
const REVIEW_CSV = path.join(ROOT, 'scripts/needs-review.csv');

// Smallest longest-side (px) for an image to count as artwork rather than a thumbnail or chrome.
const MIN_ART_SIZE = 300;

// Top-level legacy folder -> category slug. Folders not listed here are not artwork.
const CATEGORY_BY_FOLDER = {
  drawing: 'drawing',
  painting: 'painting',
  design: 'design',
  print: 'printmaking',
  ceramics: 'ceramics',
  sculpture: 'sculpture',
  photo: 'photography',
  campus: 'exhibitions',
  student: 'student-projects',
  faculty: 'faculty',
  star: 'student-spotlight',
};

// Pages whose images are not artwork: newspaper article photos and ArtBeat event photos.
const isExcludedPage = (rel) => rel === 'faculty/fac shaping.html' || rel.startsWith('student/artbeat');
const isArtBeatImage = (rel) => /^student\/(artbeat|\d\dab)/.test(rel);

// Site chrome and thumbnails, by path.
const CHROME_RE =
  /(^|\/)(images\/|icons?-|arrow|[a-z]+-menu|menu-|spacer|logo|more\.|dir-|fac-|archive\.jpe?g$|ex-fac|strip\.)|(th|-th|_th)\.jpe?g$/i;

const MEDIUM_WORDS = [
  'acrylic', 'oil', 'oils', 'graphite', 'charcoal', 'pastel', 'pastels', 'ink', 'watercolor', 'watercolour',
  'etching', 'drypoint', 'intaglio', 'linocut', 'lino', 'reduction', 'woodcut', 'monotype', 'monoprint',
  'collage', 'mixed', 'media', 'pencil', 'pencils', 'color', 'colored', 'coloured', 'conte', 'gouache',
  'screenprint', 'silkscreen', 'lithograph', 'aquatint', 'stoneware', 'porcelain', 'earthenware', 'raku',
  'clay', 'ceramic', 'bronze', 'wood', 'steel', 'wire', 'glass', 'painted', 'paper', 'canvas', 'board', 'panel',
  'chalk', 'papier', 'mache', 'opalescent', 'prismacolor', 'marker', 'markers', 'tempera', 'scratchboard',
  'digital', 'photograph', 'gelatin', 'silver', 'print', 'on', 'and', 'with', '&',
];
const MEDIUM_CORE = /\b(acrylic|oils?|graphite|charcoal|pastels?|ink|water ?colou?r|etching|drypoint|intaglio|lino(cut)?|woodcut|monotype|monoprint|collage|mixed media|pencils?|conte|gouache|screenprint|silkscreen|lithograph|aquatint|stoneware|porcelain|earthenware|raku|clay|ceramic|bronze|steel|wire|glass|papier mache|prismacolor|markers?|tempera|scratchboard)\b/i;

// Sizes written in captions, e.g. "18 x 72 inches".
const DIMENSIONS_RE = /^\d+(\.\d+)?\s*(x|×|by)\s*\d+(\.\d+)?(\s*(x|×|by)\s*\d+(\.\d+)?)?\s*(in\.?|inches|"|cm|ft|feet)?$/i;

// A page <title> counts as an artist's name only if it looks like one: 2 to 5 capitalised words.
const PERSON_RE = /^[A-ZÁÉÍÓÚÑ][\p{L}.'-]*(\s+(de|del|la|y|[A-ZÁÉÍÓÚÑ][\p{L}.'-]*)){0,4}$/u;

// Page <title>s that name a section rather than an artist.
const GENERIC_TITLE_RE =
  /(^LA\b|LA\d|AWC|Gallery|Untitled|Exhibition|Field Trip|Symposium|template|Art ?Beat|Mural|Dimensional|Photography|Now Showing|Students|Reception|Show|Paintings|Photographs|Works|Opening|Retrospective|Design|Drawings?$|Paintings?$|Prints?$|Spring|Fall|^\s*$)/i;

// ---------- helpers ----------

const posix = (p) => p.split(path.sep).join('/');

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

// Windows-1252 code points 0x80-0x9F (Node's TextDecoder treats them as latin1 control characters).
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const fromCp1252 = (s) => s.replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0) - 0x80]);

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&eacute;/gi, 'é')
    .replace(/&aacute;/gi, 'á')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      // Windows-1252 punctuation written as numeric entities (&#147; etc.).
      return code >= 128 && code <= 159 ? CP1252[code - 128] : String.fromCodePoint(code);
    });
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

function pageText(html) {
  return clean(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<map\b[\s\S]*?<\/map>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function slugify(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/%20/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveRef(pageRel, ref) {
  let u = decodeEntities(ref.trim()).split('#')[0].split('?')[0];
  if (!u || /^(https?:|mailto:|javascript:|file:)/i.test(u) || u.startsWith('/')) return null;
  try {
    u = decodeURIComponent(u);
  } catch {
    /* keep raw */
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(pageRel), u));
}

// Attribute values may be quoted (and contain spaces) or unquoted.
const ATTR = (name) => new RegExp(`<(?:%TAG%)\\b[^>]*?\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
function attrs(html, tags, name) {
  const re = new RegExp(ATTR(name).source.replace('%TAG%', tags), 'gi');
  return [...html.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3]);
}

// Fall/Spring + year from a legacy path. Returns { semester, year } (either may be null).
function whenFromPath(p) {
  const top = p.split('/')[0];
  if (top !== 'LA' && top !== 'campus' && top !== 'sympos') {
    const m =
      p.match(/(?:^|[/_ ])([fs])_?(\d{2})(?=[/_. a-z]|$)/i) ?? p.match(/\/([fs])(\d{2})\//i);
    if (m) return { semester: m[1].toLowerCase() === 'f' ? 'Fall' : 'Spring', year: 2000 + Number(m[2]) };
  }
  let m = p.match(/campus[ _-](\d{1,2})_(\d{2})(?!\d)/);
  if (m) return { semester: null, year: 2000 + Number(m[2]) };
  m = p.match(/(?:^LA\/|^campus\/|ys_|^LA\/LA|la)(\d{2})(?=[/_.]|$)/i);
  if (m) return { semester: null, year: 2000 + Number(m[1]) };
  m = p.match(/(?<!\d)(20[01]\d)(?!\d)/);
  if (m) return { semester: null, year: Number(m[1]) };
  m = p.match(/artbeat (\d{2})/);
  if (m) return { semester: null, year: 2000 + Number(m[1]) };
  m = p.match(/\/mural\/(\d{2})\b/);
  if (m) return { semester: null, year: 2000 + Number(m[1]) };
  return { semester: null, year: null };
}

function isMedium(segment) {
  const s = segment.toLowerCase().replace(/\d{4}/g, '').trim();
  if (!s || !MEDIUM_CORE.test(s)) return false;
  // Every word must be a media word, so "Portrait of my mother in oil" stays a title.
  return s.split(/[\s,/]+/).filter(Boolean).every((w) => MEDIUM_WORDS.includes(w));
}

// Splits the caption body ("Artist, Title , medium") into fields.
function parseCaption(body, knownArtist) {
  const result = { artist: knownArtist, title: null, medium: null, dimensions: null, ambiguous: false };
  const caption = body.trim();
  if (!caption) return result;

  const parts = caption.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  const head = parts[0];
  if (knownArtist) {
    if (head.toLowerCase() !== knownArtist.toLowerCase()) {
      // Extra words with no comma after the artist (e.g. "Ana Carbajal Local Color Collage").
      if (caption.toLowerCase() !== knownArtist.toLowerCase()) result.ambiguous = true;
      return result;
    }
  } else if (parts.length > 1 && head.split(' ').length <= 5 && !/\d/.test(head)) {
    result.artist = head;
  } else {
    return result;
  }

  const rest = parts.slice(1);
  const dimIndex = rest.findIndex((s) => DIMENSIONS_RE.test(s));
  if (dimIndex !== -1) result.dimensions = rest.splice(dimIndex, 1)[0];
  if (rest.length === 0) return result;
  if (isMedium(rest[rest.length - 1])) result.medium = rest.pop().replace(/\s+(19|20)\d\d$/, '');
  if (rest.length === 0) return result;
  if (result.medium || rest.length > 1) {
    result.title = rest.join(', ');
  } else {
    // A lone segment that isn't a known medium could be a title or an unlisted medium.
    result.ambiguous = true;
  }
  return result;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(' | ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- 1. read every legacy page and image ----------

const files = (await walk(LEGACY)).map((f) => posix(path.relative(LEGACY, f)));
const fileSet = new Set(files);
const byBasename = new Map();
for (const f of files) {
  const b = path.posix.basename(f).toLowerCase();
  if (!byBasename.has(b)) byBasename.set(b, []);
  byBasename.get(b).push(f);
}

const imageInfo = new Map(); // rel -> { width, height, format, bytes, md5 }
async function info(rel) {
  if (imageInfo.has(rel)) return imageInfo.get(rel);
  let value = null;
  try {
    const buf = await fs.readFile(path.join(LEGACY, rel));
    const meta = await sharp(buf).metadata();
    if (meta.width && meta.height && ['jpeg', 'gif', 'png'].includes(meta.format)) {
      value = {
        width: meta.width,
        height: meta.height,
        format: meta.format,
        bytes: buf.length,
        md5: createHash('md5').update(buf).digest('hex'),
      };
    }
  } catch {
    value = null;
  }
  imageInfo.set(rel, value);
  return value;
}

const pages = new Map();
for (const rel of files.filter((f) => /\.html?$/i.test(f))) {
  const html = fromCp1252((await fs.readFile(path.join(LEGACY, rel))).toString('latin1'));
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  pages.set(rel, {
    rel,
    title: titleMatch ? clean(titleMatch[1]) : '',
    text: pageText(html),
    imgs: attrs(html, 'img', 'src').map((s) => resolveRef(rel, s)).filter(Boolean),
    links: attrs(html, 'a|area', 'href').map((s) => resolveRef(rel, s)).filter(Boolean),
  });
}

// Reachability from the site's entry points.
const reachable = new Set();
const stack = ['index.html', 'directory.html', 'faculty.html'];
while (stack.length) {
  const p = stack.pop();
  if (reachable.has(p) || !pages.has(p)) continue;
  reachable.add(p);
  for (const l of pages.get(p).links) if (/\.html?$/i.test(l)) stack.push(l);
}

// Semester index pages: link to detail pages and carry the course line
// ("Drawing I, II & III fall 2014").
const courseByPage = new Map();
for (const page of pages.values()) {
  const m = page.text.match(
    /\b((?:2-D |3-D |2D |3D )?(?:Drawing|Painting|Printmaking|Ceramics|Sculpture|Design|Photography)(?: I{1,3}| IV)(?:\s*,\s*I{1,3}| IV)*(?:\s*(?:&|and)\s*I{1,3})?)\s+(?:fall|spring)\b/i,
  );
  if (!m) continue;
  for (const l of page.links) if (!courseByPage.has(l)) courseByPage.set(l, clean(m[1]));
}

// Finds a missing image by basename elsewhere in the same top-level folder
// (e.g. design/2d/f_05_1.html -> design/2d/archive/04/des_f_05_1.jpg).
function recover(ref) {
  if (fileSet.has(ref)) return ref;
  const top = ref.split('/')[0];
  const candidates = (byBasename.get(path.posix.basename(ref).toLowerCase()) ?? []).filter(
    (c) => c.split('/')[0] === top,
  );
  return candidates.length === 1 ? candidates[0] : null;
}

// ---------- 2. collect artwork and LA-trip images from pages ----------

const artworks = new Map(); // md5 -> record
const laPhotos = new Map(); // md5 -> record
const recovered = [];

function caption(page) {
  let body = page.text;
  if (page.title && body.startsWith(page.title)) body = body.slice(page.title.length);
  body = body.split(/\s(?:l|\|)\s|AWC Gallery Home|gallery home|Exhibition Archive|\bback\b|\bnext\b|\s[fs] '\d\d\b/i)[0];
  return body.replace(/\s+/g, ' ').trim();
}

for (const page of [...pages.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
  const top = page.rel.includes('/') ? page.rel.split('/')[0] : null;
  const isLA = top === 'LA';
  if (!isLA && !(top in CATEGORY_BY_FOLDER)) continue;
  if (isExcludedPage(page.rel)) continue;

  const imgs = [];
  for (const ref of new Set(page.imgs)) {
    const real = recover(ref);
    if (!real || CHROME_RE.test(real) || (isLA && real.startsWith('LA/images/'))) continue;
    const meta = await info(real);
    if (!meta || Math.max(meta.width, meta.height) < MIN_ART_SIZE) continue;
    if (real !== ref) recovered.push({ page: page.rel, ref, real });
    imgs.push(real);
  }
  if (imgs.length === 0) continue;

  const body = caption(page);
  const titleIsArtist = PERSON_RE.test(page.title) && !GENERIC_TITLE_RE.test(page.title);
  // Exhibition captions mix "Artist, title" and "Title, medium" orders, so they aren't split
  // into fields; the caption is kept whole as the description instead.
  const parsed =
    top === 'campus'
      ? { artist: titleIsArtist ? page.title : null, title: null, medium: null, dimensions: null, ambiguous: false }
      : parseCaption(body, titleIsArtist ? page.title : null);
  const isReachable = reachable.has(page.rel);

  for (const img of imgs) {
    const meta = imageInfo.get(img);
    let when = whenFromPath(page.rel);
    if (when.year === null) when = whenFromPath(img);
    const imgWhen = whenFromPath(img);
    const conflict =
      imgWhen.year !== null && when.year !== null && imgWhen.year !== when.year && top !== 'campus' && !isLA;

    if (isLA) {
      const existing = laPhotos.get(meta.md5);
      if (existing) {
        existing.sourcePages.push(page.rel);
        continue;
      }
      laPhotos.set(meta.md5, {
        legacyImage: img,
        year: when.year,
        caption: body && !/^LA\b/i.test(body) ? body : null,
        pageTitle: page.title || null,
        sourcePages: [page.rel],
        reachable: isReachable,
      });
      continue;
    }

    const record = {
      legacyImage: img,
      category: CATEGORY_BY_FOLDER[top],
      artist: parsed.artist,
      title: parsed.title,
      year: when.year,
      semester: when.semester,
      medium: parsed.medium,
      dimensions: parsed.dimensions,
      description: top === 'campus' && body ? body : null,
      campus: /\/sllc\//.test(page.rel) ? 'San Luis' : /\/yuma\//.test(page.rel) ? 'Yuma' : null,
      course: courseByPage.get(page.rel) ?? null,
      sourcePages: [page.rel],
      fileSize: meta.bytes,
      width: meta.width,
      height: meta.height,
      caption: body || null,
      flags: [],
      reachable: isReachable,
    };
    if (parsed.ambiguous) record.flags.push('ambiguous caption');
    if (conflict) record.flags.push(`filename suggests ${imgWhen.year}`);
    if (!isReachable) record.flags.push('only on an orphaned legacy page');
    if (imgs.length > 1) record.flags.push('one of several images on its page');

    const existing = artworks.get(meta.md5);
    if (!existing) {
      artworks.set(meta.md5, record);
      continue;
    }
    // Keep the copy on the better page: reachable beats orphaned, a course folder beats star/.
    const better =
      (record.reachable && !existing.reachable) ||
      (record.reachable === existing.reachable &&
        existing.category === 'student-spotlight' &&
        record.category !== 'student-spotlight');
    const pagesSoFar = [...existing.sourcePages, ...record.sourcePages];
    if (better) {
      // Fill gaps from the other copy rather than lose metadata.
      for (const k of ['artist', 'title', 'medium', 'dimensions']) record[k] ??= existing[k];
      record.sourcePages = pagesSoFar;
      record.flags = record.flags.filter((f) => f !== 'only on an orphaned legacy page');
      artworks.set(meta.md5, record);
    } else {
      for (const k of ['artist', 'title', 'medium', 'dimensions']) existing[k] ??= record[k];
      existing.sourcePages = pagesSoFar;
      if (record.reachable) existing.flags = existing.flags.filter((f) => f !== 'only on an orphaned legacy page');
    }
  }
}

// ---------- 3. artwork-sized images that no page shows ----------

const referenced = new Set([...pages.values()].flatMap((p) => p.imgs.map((r) => recover(r) ?? r)));
const unreferenced = [];
for (const rel of files) {
  const top = rel.split('/')[0];
  if (!(top in CATEGORY_BY_FOLDER) || referenced.has(rel) || CHROME_RE.test(rel) || isArtBeatImage(rel)) continue;
  if (/\.(html?|db|tmp|xml)$/i.test(rel)) continue;
  const meta = await info(rel);
  if (!meta || Math.max(meta.width, meta.height) < MIN_ART_SIZE || meta.format === 'gif') continue;
  if (artworks.has(meta.md5)) continue;
  const when = whenFromPath(rel);
  artworks.set(meta.md5, {
    legacyImage: rel,
    category: CATEGORY_BY_FOLDER[top],
    artist: null,
    title: null,
    year: when.year,
    semester: when.semester,
    medium: null,
    dimensions: null,
    description: null,
    campus: /\/sllc\//.test(rel) ? 'San Luis' : /\/yuma\//.test(rel) ? 'Yuma' : null,
    course: null,
    sourcePages: [],
    fileSize: meta.bytes,
    width: meta.width,
    height: meta.height,
    caption: null,
    flags: ['image not shown on any legacy page'],
    reachable: false,
  });
  unreferenced.push(rel);
}

// ---------- 4. ids, image copies, output ----------

function makeId(rel, used) {
  const base = slugify(rel.replace(/\.(jpe?g|gif|png)$/i, '')) || 'artwork';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

const extFor = (meta) => (meta.format === 'jpeg' ? 'jpg' : meta.format);

async function writeImages(records, dir, relPrefix) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const r of records) {
    const file = `${r.id}.${extFor(imageInfo.get(r.legacyImage))}`;
    await fs.copyFile(path.join(LEGACY, r.legacyImage), path.join(dir, file));
    r.image = `${relPrefix}/${file}`;
  }
}

const semesterOrder = (s) => (s === 'Spring' ? 0 : s === 'Fall' ? 1 : 2);
const usedIds = new Set();
const categoryOrder = Object.values(CATEGORY_BY_FOLDER);
const artList = [...artworks.values()].sort(
  (a, b) =>
    categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) ||
    (a.year ?? 9999) - (b.year ?? 9999) ||
    semesterOrder(a.semester) - semesterOrder(b.semester) ||
    a.legacyImage.localeCompare(b.legacyImage, 'en', { numeric: true }),
);
for (const r of artList) r.id = makeId(r.legacyImage, usedIds);
await writeImages(artList, ART_DIR, '../assets/artworks');

const laList = [...laPhotos.values()].sort(
  (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.legacyImage.localeCompare(b.legacyImage, 'en', { numeric: true }),
);
const laIds = new Set();
for (const r of laList) r.id = makeId(r.legacyImage, laIds);
await writeImages(laList, LA_DIR, '../assets/la-trips');

const artOut = artList.map((r) => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  year: r.year,
  semester: r.semester,
  category: r.category,
  medium: r.medium,
  dimensions: r.dimensions,
  description: r.description,
  campus: r.campus,
  course: r.course,
  image: r.image,
  width: r.width,
  height: r.height,
  sourcePage: r.sourcePages[0] ? `legacy/${r.sourcePages[0]}` : null,
  otherSourcePages: r.sourcePages.slice(1).map((p) => `legacy/${p}`),
  legacyImage: `legacy/${r.legacyImage}`,
}));

const laOut = laList.map((r) => ({
  id: r.id,
  year: r.year,
  caption: r.caption,
  image: r.image,
  sourcePage: `legacy/${r.sourcePages[0]}`,
  legacyImage: `legacy/${r.legacyImage}`,
}));

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.writeFile(path.join(DATA_DIR, 'artworks.json'), JSON.stringify(artOut, null, 2) + '\n');
await fs.writeFile(path.join(DATA_DIR, 'la-trips.json'), JSON.stringify(laOut, null, 2) + '\n');

// Real prose worth carrying over: the LA trip introduction and symposium presenter notes.
function prose(rel) {
  const page = pages.get(rel);
  let text = page.text;
  if (page.title && text.startsWith(page.title)) text = text.slice(page.title.length);
  return text.replace(/\s*(gallery home|home|AWC Online Art Gallery)\s*$/i, '').trim();
}
const laIntro = prose('LA/la.html').replace(/(\s+\d{4})+$/, '').trim();
const symposium = [...pages.values()]
  .filter((p) => /^sympos\/ys_\d\d\//.test(p.rel))
  .map((p) => ({ year: whenFromPath(p.rel).year, heading: p.title, text: prose(p.rel), sourcePage: `legacy/${p.rel}` }))
  .filter((p) => p.text.length > 100)
  .sort((a, b) => a.year - b.year);
await fs.writeFile(
  path.join(DATA_DIR, 'legacy-text.json'),
  JSON.stringify({ laIntro: { text: laIntro, sourcePage: 'legacy/LA/la.html' }, symposium }, null, 2) + '\n',
);

// needs-review.csv: anything missing title, artist or year, or carrying a flag.
const reviewCols = [
  'id', 'category', 'year', 'semester', 'artist', 'title', 'medium', 'missing', 'flags',
  'legacy_caption', 'fileSize', 'image', 'sourcePage', 'legacyImage',
];
const reviewRows = artList
  .map((r) => {
    const missing = ['title', 'artist', 'year'].filter((k) => r[k] === null);
    return { r, missing };
  })
  .filter(({ r, missing }) => missing.length || r.flags.length)
  .map(({ r, missing }) =>
    [
      r.id, r.category, r.year, r.semester, r.artist, r.title, r.medium, missing.join(' '), r.flags.join('; '),
      r.caption, r.fileSize, r.image.replace('../', 'src/'), r.sourcePages[0] ? `legacy/${r.sourcePages[0]}` : '',
      `legacy/${r.legacyImage}`,
    ]
      .map(csvCell)
      .join(','),
  );
await fs.writeFile(REVIEW_CSV, [reviewCols.join(','), ...reviewRows].join('\n') + '\n');

// ---------- 5. summary ----------

const count = (list, key) =>
  Object.entries(list.reduce((acc, r) => ((acc[r[key] ?? 'unknown'] = (acc[r[key] ?? 'unknown'] ?? 0) + 1), acc), {}))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
console.log(`Artworks: ${artOut.length}`);
console.log(`  by category: ${count(artOut, 'category')}`);
console.log(`  by year: ${count(artOut, 'year')}`);
for (const k of ['artist', 'title', 'medium', 'year', 'semester']) {
  console.log(`  with ${k}: ${artOut.filter((r) => r[k] !== null).length}`);
}
console.log(`  recovered from moved images: ${recovered.length}`);
console.log(`  unreferenced images included: ${unreferenced.length}`);
console.log(`LA trip photos: ${laOut.length}`);
console.log(`needs-review.csv rows: ${reviewRows.length}`);
if (!existsSync(path.join(DATA_DIR, 'artworks.json'))) process.exit(1);
