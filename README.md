# Nurzam’s Library

A public-facing, Playful Neo-Brutalist personal book library website powered by **Notion** as the single source of truth, **GitHub Actions** for automated synchronisation, and **GitHub Pages** for static hosting.

---

## 1. Project Overview

**Nurzam’s Library** is a read-only digital catalogue documenting a personal reading life. Visitors can:

- Explore an overview of the collection, current reads with page progress, favourites, and recently added books on **Home / Library**.
- Discover what to read next via **To Read** and its transparent **Curated Next Up** rule-based recommendation engine.
- Filter, sort, and browse completed books in **Read** (with Grid and List views, excluding DNF books from completion totals).
- Browse upcoming titles in **Wishlist**.
- Explore normalised **Genres** and **Authors** directories.
- Follow year-by-year **Reading History**, monthly completion charts, format distributions, and chronological timelines.
- **Search** across titles, authors, genres, publishers, ISBNs, and descriptions, or open any dedicated **Book Detail** view.

---

## 2. Architecture

```text
                    NOTION
              (Book Database)
                     |
                Notion API
                     v
              GITHUB ACTIONS
            (Scheduled + Manual)
                     |
       Inspect schema, paginate, map,
      validate, and sanitise public data
                     v
             data/library.json
                     |
                GITHUB PAGES
                     v
             NURZAM'S LIBRARY
          Static Public Website
```

- **No backend server**: The public website loads `./data/library.json` directly in the browser.
- **Privacy by design**: `NOTION_TOKEN` and `NOTION_DATABASE_ID` live exclusively in GitHub Repository Secrets (or local `.env` for testing) and never appear in client code or `data/library.json`. Private notes and private highlights are excluded by an explicit public-field allowlist.
- **Fault tolerance**: If the Notion API returns an error or an unexpected empty payload, `scripts/sync-notion.js` exits with a non-zero status and leaves the previously published `data/library.json` untouched.

---

## 3. Technology Stack

- **Frontend**: Semantic HTML5, CSS3 (Playful Neo-Brutalist design system), Vanilla JavaScript (ES6+ modules), Google Fonts (`Bricolage Grotesque`, `DM Sans`, `JetBrains Mono`), inline SVG icons. Zero frontend frameworks or build dependencies.
- **Synchronisation**: Node.js (v20+ native `fetch`, zero runtime npm dependencies), Notion REST API (`2022-06-28`).
- **Automation & Hosting**: GitHub Actions + GitHub Pages.

---

## 4. Folder Structure

```text
nurzams-library/
├── index.html                          # Main HTML entry point (relative paths for GitHub Pages)
├── README.md                           # Documentation & setup guide
├── package.json                        # CLI script shortcuts (zero runtime dependencies)
├── .env.example                        # Local environment template
├── .gitignore
├── assets/
│   ├── css/
│   │   ├── style.css                   # Design tokens, typography, Neo-Brutalist primitives
│   │   ├── components.css              # Header, hero, cards, filters, charts, detail view
│   │   └── responsive.css              # Laptop, tablet, mobile, reduced-motion styles
│   ├── js/
│   │   ├── app.js                      # Application bootstrap, state, routing, error/retry
│   │   ├── data.js                     # Session-cached JSON loader & record normalisation
│   │   ├── navigation.js               # Hash router (#/...), active links, mobile menu
│   │   ├── library.js                  # Home, To Read, Read, Wishlist, Genres, Authors, History
│   │   ├── book-detail.js              # Book card & dedicated book detail view
│   │   ├── recommendations.js          # Modular rule-based Curated Next Up scorer
│   │   ├── statistics.js               # Dynamic collection & yearly statistics
│   │   ├── search.js                   # Global instant search across all public fields
│   │   ├── filters.js                  # Reusable filter & sort helpers
│   │   └── utils.js                    # HTML escaping, date parsing, cover fallback helpers
│   └── images/
│       ├── logo.svg                    # Library mark & favicon
│       ├── placeholder-cover.svg       # Neo-Brutalist cover fallback graphic
│       └── covers/                     # Local SVG artwork for the sample development dataset
├── data/
│   └── library.json                    # Published catalogue (starts with clearly marked sample data)
├── scripts/
│   ├── notion-mapping.config.json      # Configurable property/status/format mappings & allowlist
│   ├── inspect-notion.js               # Read-only Notion schema inspector
│   ├── sync-notion.js                  # Paginated Notion sync + diff check + atomic write
│   ├── notion-mapper.js                # Notion property extractor & mapper
│   ├── data-validator.js               # Sanitiser, deduplicator, and validator
│   ├── utils.js                        # Retry/rate-limit fetch & atomic file helpers
│   ├── dev-server.js                   # Local static preview server (npm run dev)
│   ├── build-static.js                 # Static asset verifier & dist packager
│   └── lint.js                         # Syntax, JSON, and asset checker
└── .github/
    └── workflows/
        ├── sync-notion.yml             # Scheduled + manual Notion sync workflow
        └── deploy.yml                  # GitHub Pages deployment workflow
```

---

## 5. How to Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Click **+ New integration**.
3. Give it a clear name (for example, `Nurzams Library Sync`) and select the workspace containing your book database.
4. Set Capabilities to **Read content** only (this project never modifies your Notion database).
5. Submit and copy the **Internal Integration Secret** (starts with `secret_` or `ntn_`).

---

## 6. How to Connect the Integration to Your Database

1. Open your Book Database page in Notion.
2. Click the **`•••`** menu in the top-right corner of the page.
3. Scroll to **Connections** (or **Add connections**).
4. Search for and select your new integration (`Nurzams Library Sync`) and confirm access.

---

## 7. How to Identify the Notion Database ID

1. Open your Book Database as a full page in Notion.
2. Copy the page URL from your browser address bar. It looks like:
   ```text
   https://www.notion.so/myworkspace/a8aec43384f447ed84390e8b42c2e889?v=...
   ```
3. The 32-character hexadecimal string before `?v=` (`a8aec43384f447ed84390e8b42c2e889`) is your **Database ID**.

---

## 8. How to Configure GitHub Secrets

1. Open your repository on GitHub.
2. Navigate to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret** and add:
   - `NOTION_TOKEN` — your Notion Internal Integration Secret.
   - `NOTION_DATABASE_ID` — your 32-character Notion Database ID.

Never commit `.env` or paste tokens into frontend files.

---

## 9. How to Configure GitHub Pages

1. In your GitHub repository, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Ensure your default branch is named `main` (or update the branch trigger in `.github/workflows/deploy.yml`).
4. Push to `main` (or run the **Deploy to GitHub Pages** workflow manually). All asset and `data/library.json` paths are relative (`./...`) and routing uses URL hashes (`#/...`), so the site works cleanly at both root domains and repository subpaths (`https://<user>.github.io/<repo>/`).

---

## 10. How Automated Synchronisation Works

The `.github/workflows/sync-notion.yml` workflow:

1. Triggers on a cron schedule (`*/10 * * * *`, or change to `*/30 * * * *` if you prefer 30-minute ticks) and via manual `workflow_dispatch`.
2. Runs `node scripts/sync-notion.js` using `NOTION_TOKEN` and `NOTION_DATABASE_ID`.
3. Inspects your live database schema, fetches every page across Notion pagination cursors (`has_more` / `next_cursor`), retries transient `429`/`5xx` responses with backoff, transforms properties via `scripts/notion-mapping.config.json`, validates/deduplicates records, and strips non-public fields.
4. Compares the new book list against `data/library.json` and only commits when changes are detected.
5. Pushes the updated `data/library.json`, which triggers `.github/workflows/deploy.yml` to publish the updated site to GitHub Pages.

> **Note:** GitHub Actions scheduled cron jobs are best-effort and may run slightly behind schedule during peak GitHub load.

---

## 11. Running Inspection & Sync Manually

### Via GitHub Actions UI

1. Open the **Actions** tab in your GitHub repository.
2. Select **Sync Notion Library**.
3. Click **Run workflow**.

### Locally for Testing

1. Copy `.env.example` to `.env` and fill in `NOTION_TOKEN` and `NOTION_DATABASE_ID`.
2. Inspect your live Notion schema first (read-only):
   ```bash
   npm run inspect-notion
   ```
   This prints every property in your database, which fields matched automatically, which fields are excluded as private, and any unmapped properties.
3. Run the sync script:
   ```bash
   npm run sync
   ```
4. Preview the static site locally on port 3000:
   ```bash
   npm run dev
   ```

---

## 12. Troubleshooting Synchronisation Failures

- **HTTP 401 / Unauthorized**: Verify `NOTION_TOKEN` is valid and has no trailing whitespace in GitHub Secrets.
- **HTTP 404 / Object not found**: Confirm your integration has been added under **Connections** on the specific Notion database page, and verify `NOTION_DATABASE_ID`.
- **Missing fields or wrong shelf names**: Run `npm run inspect-notion` to inspect exact property names and select values, then update `scripts/notion-mapping.config.json`.
- **Rate limits (HTTP 429)**: The script automatically honours `Retry-After` headers and retries with exponential backoff.
- **Workflow didn't commit**: If Notion data did not change since the last sync, the script intentionally skips writing and committing to keep Git history clean.

---

## 13. Modifying Notion Property Mappings

Open `scripts/notion-mapping.config.json`:

- **`properties`**: Each internal field accepts an array of candidate Notion property names (case-insensitive, checked in order). Add your own column names to any array.
- **`statusMap` / `formatMap`**: Map custom Notion labels (e.g., `"Completed"` -> `"Read"`, `"Hardcover"` -> `"Hardback"`).
- **`privateFieldPatterns` & `publicAllowlist`**: Control what is excluded by default vs. allowed into `data/library.json`. Note that `review` and `highlights` are only published when the property name contains `"public"` (such as `"Public Review"`) or an explicit `"Public Review?"` checkbox/flag is set to `true` / `"Public"`.

---

## 14. Extending the Recommendation Engine

The **Curated Next Up** recommender lives in `assets/js/recommendations.js`.

- Adjust factor weights in `DEFAULT_RECOMMENDATION_CONFIG.weights` (`genreAffinity`, `authorFamiliarity`, `lengthBalance`, `readingVariety`, `personalPreference`).
- `generateRecommendations(books, customConfig)` is self-contained and returns `{ hasEnoughHistory, recommendations: [{ book, score, reason }], note }`, making it straightforward to add new scoring heuristics or plug in an external ranking source later.

---

## 15. Adding New Website Sections

1. Add a navigation link with a `data-route` attribute in `index.html` (both desktop `<nav>` and mobile drawer).
2. Add the hash route case in `assets/js/navigation.js` (`parseRoute`).
3. Create a view renderer returning `{ title, html, mount? }` in `assets/js/library.js` (or a new ES module).
4. Wire the route case inside `renderRoute` in `assets/js/app.js`.
