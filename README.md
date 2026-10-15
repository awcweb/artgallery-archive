# AWC Art Gallery Archive

An accessible, searchable archive of the Arizona Western College art gallery (2001–2018), built with [Astro](https://astro.build) and published to GitHub Pages at **https://awcweb.github.io/artgallery-archive/**.

Visitors can browse every artwork, search by title, artist, medium or description, and filter by category and year. Filtered views live in the URL (`?q=&category=&year=`), so they can be shared and bookmarked. Category, year and artwork pages are plain static HTML, so the content is reachable without JavaScript.

## Local development

You need Node.js 22.22 or newer.

```sh
npm install
npm run dev       # http://localhost:4321/artgallery-archive/
npm run build     # type-checks, then builds the site into dist/
npm run preview   # serves the built dist/ folder
```

The first build optimizes about 2,000 images and takes a minute or two. Later builds reuse the image cache in `node_modules/.astro`.

## Project layout

| Path | What it is |
|---|---|
| `src/data/artworks.json` | One record per artwork: the source of truth for the gallery |
| `src/data/la-trips.json` | Photos for the LA Trips album |
| `src/data/legacy-text.json` | Prose carried over from the old site (LA trip intro, symposium notes) |
| `src/assets/artworks/`, `src/assets/la-trips/` | Original images, named after each record's `id` |
| `src/content.config.ts` | The zod schema. Any bad record or missing image fails the build |
| `src/pages/` | Home gallery, `/category/[slug]/`, `/year/[year]/`, `/art/[id]/`, About, LA Trips |
| `src/scripts/gallery.ts` | The small client-side search and filter script |
| `src/icons/` | Category icons (SVG, they follow the text colour in light and dark mode) |
| `scripts/extract.mjs` | Parses the legacy site into the data files above |
| `scripts/needs-review.csv` | Records missing a title, artist or year, or flagged as ambiguous |
| `legacy/` | The original hand-written site, kept for reference. It's not part of the build |

## Adding a new artwork

1. Put the image in `src/assets/artworks/`. Name it after the new record's id, for example `painting-2024-maria-lopez-1.jpg`.
2. Add a record to `src/data/artworks.json`:

   ```json
   {
     "id": "painting-2024-maria-lopez-1",
     "title": "Desert Light",
     "artist": "Maria Lopez",
     "year": 2024,
     "semester": "Spring",
     "category": "painting",
     "medium": "acrylic on canvas",
     "dimensions": "18 x 24 in",
     "description": null,
     "campus": "Yuma",
     "course": "Painting I, II & III",
     "image": "../assets/artworks/painting-2024-maria-lopez-1.jpg",
     "width": 1200,
     "height": 900,
     "sourcePage": null,
     "otherSourcePages": [],
     "legacyImage": null
   }
   ```

   - `id` must be unique, lowercase, with words joined by hyphens. It becomes the page address `/art/<id>/`.
   - `category` is one of `drawing`, `painting`, `design`, `printmaking`, `ceramics`, `sculpture`, `photography`, `exhibitions`, `student-projects`, `faculty`, `student-spotlight`.
   - `semester` is `"Spring"`, `"Fall"` or `null`; `campus` is `"Yuma"`, `"San Luis"` or `null`.
   - Use `null` for anything you don't know. Don't guess.
   - `width` and `height` are the image's pixel size.
   - `sourcePage` and `legacyImage` point into `legacy/` for migrated work. Use `null` for new work.
3. Run `npm run build`. If anything is wrong (a missing image, a misspelt category, an unexpected field), the build stops and names the record.

> **Note:** re-running `scripts/extract.mjs` regenerates `artworks.json` from `legacy/` and **replaces hand edits**. Once people start correcting records or adding new work, treat `artworks.json` as the source of truth and stop re-running the extraction.

## Filling in missing information

`scripts/needs-review.csv` lists every record that is missing a title, artist or year, or that the extraction flagged:

- **ambiguous caption:** the caption had words after the artist that could be a title or a medium.
- **filename suggests YYYY:** the image's filename year disagrees with the semester folder it was published in.
- **only on an orphaned legacy page:** no link on the old site led to the work's page.
- **image not shown on any legacy page:** the image sat in a folder without a page.

`legacy_caption` shows the original caption text, and `fileSize` is the original image's size in bytes. To fix a record, edit the matching entry in `src/data/artworks.json` (search for its `id`).

## Re-running the extraction

```sh
npm run extract   # node scripts/extract.mjs
```

The script reads `legacy/`, rewrites `src/data/*.json`, recopies the images in `src/assets/artworks/` and `src/assets/la-trips/`, and rewrites `scripts/needs-review.csv`. It prints a summary of counts. It never invents metadata: anything it can't read from the old pages or folder names is left `null`. See the comments at the top of the script for the parsing rules.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`. The workflow builds the site with the official [`withastro/action`](https://github.com/withastro/action) and publishes it with [`actions/deploy-pages`](https://github.com/actions/deploy-pages). You can also run it by hand from the repository's **Actions** tab.

One-time setup: in the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

The site lives under `/artgallery-archive/` (set by `site` and `base` in `astro.config.mjs`). Internal links go through the `url()` helper in `src/lib/site.ts`, which adds that base path, so links and images also work locally.
