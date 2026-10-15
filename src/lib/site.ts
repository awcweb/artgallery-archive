import { getCollection, type CollectionEntry } from 'astro:content';
import { CATEGORY_SLUGS } from '../content.config';

import ceramicsIcon from '../icons/ceramics.svg?raw';
import designIcon from '../icons/design.svg?raw';
import drawingIcon from '../icons/drawing.svg?raw';
import paintingIcon from '../icons/painting.svg?raw';
import photographyIcon from '../icons/photography.svg?raw';
import printmakingIcon from '../icons/printmaking.svg?raw';
import sculptureIcon from '../icons/sculpture.svg?raw';
import starIcon from '../icons/star.svg?raw';

export type Artwork = CollectionEntry<'artworks'>;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export const SITE_TITLE = 'AWC Art Gallery Archive';

export interface Category {
  slug: CategorySlug;
  label: string;
  icon?: string;
}

export const CATEGORIES: Category[] = [
  { slug: 'drawing', label: 'Drawing', icon: drawingIcon },
  { slug: 'painting', label: 'Painting', icon: paintingIcon },
  { slug: 'design', label: 'Design', icon: designIcon },
  { slug: 'printmaking', label: 'Printmaking', icon: printmakingIcon },
  { slug: 'ceramics', label: 'Ceramics', icon: ceramicsIcon },
  { slug: 'sculpture', label: 'Sculpture', icon: sculptureIcon },
  { slug: 'photography', label: 'Photography', icon: photographyIcon },
  { slug: 'exhibitions', label: 'Exhibitions' },
  { slug: 'student-projects', label: 'Student Projects' },
  { slug: 'faculty', label: 'Faculty' },
  { slug: 'student-spotlight', label: 'Student Spotlight', icon: starIcon },
];

const categoryBySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));
export const category = (slug: CategorySlug): Category => categoryBySlug.get(slug)!;

/** Year key used in URLs and filters; works with no recorded year are grouped as "unknown". */
export const UNKNOWN_YEAR = 'unknown';
export const yearKey = (year: number | null): string => (year === null ? UNKNOWN_YEAR : String(year));
export const yearLabel = (key: string): string => (key === UNKNOWN_YEAR ? 'Unknown year' : key);

/** Prefixes a site path with the configured base (/artgallery-archive/). */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return base + path.replace(/^\//, '');
}

export const artUrl = (id: string) => url(`art/${id}/`);
export const categoryUrl = (slug: string) => url(`category/${slug}/`);
export const yearUrl = (key: string) => url(`year/${key}/`);

const semesterRank = (s: string | null) => (s === 'Spring' ? 0 : s === 'Fall' ? 1 : 2);

/** All artworks in archive order: category, then year (unknown last), semester, then id. */
export async function getArtworks(): Promise<Artwork[]> {
  const all = await getCollection('artworks');
  const order = new Map(CATEGORY_SLUGS.map((slug, i) => [slug, i]));
  return all.sort(
    (a, b) =>
      order.get(a.data.category)! - order.get(b.data.category)! ||
      (a.data.year ?? 9999) - (b.data.year ?? 9999) ||
      semesterRank(a.data.semester) - semesterRank(b.data.semester) ||
      a.id.localeCompare(b.id, 'en', { numeric: true }),
  );
}

/** Year keys present in the data, newest first, with "unknown" last. */
export function yearKeys(works: Artwork[]): string[] {
  const years = [...new Set(works.map((w) => w.data.year).filter((y): y is number => y !== null))].sort(
    (a, b) => b - a,
  );
  const keys = years.map(String);
  if (works.some((w) => w.data.year === null)) keys.push(UNKNOWN_YEAR);
  return keys;
}

export function whenLabel(data: Artwork['data']): string | null {
  if (data.year === null) return null;
  return data.semester ? `${data.semester} ${data.year}` : String(data.year);
}

/** Visible heading for a work. Titles are never invented, so untitled records say so plainly. */
export const displayTitle = (data: Artwork['data']): string => data.title ?? 'Title not recorded';

/** Alt text built only from recorded metadata. */
export function altText(data: Artwork['data']): string {
  const what = data.title ? `"${data.title}"` : `${category(data.category).label} work`;
  const parts = [data.artist ? `${what} by ${data.artist}` : what];
  if (data.medium) parts.push(data.medium);
  const when = whenLabel(data);
  if (when) parts.push(when);
  return parts.join(', ');
}
