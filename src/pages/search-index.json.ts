import type { APIRoute } from 'astro';
import { getArtworks, yearKey } from '../lib/site';

/** Compact index used by the gallery's client-side search and filters. */
export interface IndexEntry {
  /** artwork id */
  i: string;
  /** category slug */
  c: string;
  /** year key ("unknown" when not recorded) */
  y: string;
  /** lowercase text searched: title, artist, medium, description */
  s: string;
}

export const GET: APIRoute = async () => {
  const works = await getArtworks();
  const index: IndexEntry[] = works.map(({ id, data }) => ({
    i: id,
    c: data.category,
    y: yearKey(data.year),
    s: [data.title, data.artist, data.medium, data.description]
      .filter(Boolean)
      .join(' \u0000 ')
      .toLowerCase(),
  }));
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
};
