# Social Evidence — SPEC v0.5

Status: **approved by the owner.** Stages 2 and 3 are implemented. Sections that describe later stages say so.

## 1. Goal

A Chrome extension (Manifest V3, TypeScript, Vite) that lets a person who is browsing normally document a post with one click or one keyboard shortcut.

Each capture produces:

- a screenshot with an information strip (URL, date and time with timezone, running number, platform),
- metadata pre-filled from the page, in a form the user can correct before saving,
- a numbered entry in a per-case register.

A case exports as one ZIP: numbered images, CSV, XLSX, SHA-256 hashes, and an audit log.

The user searches and browses. The extension only documents.

## 2. Users and scenarios

- **User:** one person on their own machine, documenting posts they find while searching manually. The evidence may later be used in a formal complaint or in legal proceedings (see §10).
- **Main scenario:** the user finds a post in a group, opens it on its own page, presses `Alt+Shift+S`, the side panel shows the form, the user corrects fields, adds the keyword and notes, and saves. This repeats for hundreds of posts. The case is then exported.
- **Out of scope:** several users, collaboration, cloud sync, any guarantee of legal admissibility.

## 3. Non-goals (binding)

1. **No automation of browsing.** No automatic navigation, clicking, scrolling through groups or feeds, scraping, or unofficial API calls. The extension acts only on a user gesture and only on the tab that is open.
   - One bounded exception, approved by the owner: a user-started full-page capture scrolls the **current page** to stitch slices. It never navigates, never opens another post or group, and restores the scroll position afterwards.
2. **Local only.** No server, no analytics, no network request made by the extension, no remotely hosted code.
3. **Minimal permissions**, each justified in §14 and in the README.

## 4. Platform detection

`detectPlatform(url: string): Platform | null` is a pure function.

| Hostname (exact, or suffix on a dot boundary) | Platform |
|---|---|
| `facebook.com`, `fb.com` (including `www.`, `m.`, `web.`) | `facebook` |
| `tiktok.com` | `tiktok` |
| `instagram.com` | `instagram` |
| any other `http:` / `https:` URL | `website` |
| anything else (`chrome://`, `file:`, `about:` …) | `null` — capture is refused with a message |

Lookalikes such as `facebook.com.evil.example` and `notfacebook.com` map to `website`. Matching uses the parsed hostname, never a substring of the URL.

## 5. User flows

**Workflow rule: one post, one page.** Before capturing a post, the user opens it on its own page, by clicking the post's date or time. The tab address is then the post's permalink, which is the address printed on the strip, and the adapter reads the right post. Capturing from a feed records the feed's address and may pick up details of a neighbouring post. The rule is shown in the side panel's empty state and in the README.

**F1 — Capture the visible area**

1. The user clicks the toolbar icon or presses the shortcut. Chrome grants `activeTab` for that tab.
2. The service worker opens the side panel if it is closed and waits until the page has settled at its narrower width (§8).
3. The service worker records the time and the tab address and calls `captureVisibleTab` (PNG).
4. The adapter for the detected platform reads the post's details from the page (§9). It runs after the screenshot, so it cannot affect what the screenshot shows.
5. The side panel shows the form with a preview of the image and its strip. Fields read from the page are marked; sticky fields carry their last saved values (§13).
6. The user edits and presses **שמור**. The running number is assigned, the strip is drawn, the file is hashed, and everything is written in one transaction (§6.4).
7. Confirmation: "נשמר #0007".

A page that is not http(s) is refused with a message in the panel. Nothing is stored for it.

**F2 — Capture a full page**

Started by a second shortcut (`Alt+Shift+F`) or by the **צילום עמוד מלא** button in the form.

1. A script in the page reads the page height and viewport height and remembers the current scroll position.
2. Loop: scroll one viewport down, wait about 600 ms, capture, stop at the bottom or at the height cap.
3. The original scroll position is restored, also on error or cancel.
4. The slices are stitched into one image. The flow continues as F1 from step 4.

- Height cap: 15,000 CSS px, and never more than 30,000 device px or 200 megapixels of output, to stay inside Chrome's canvas limits. The cap is shown in the UI.
- A cancel button is visible for the whole capture.
- If two consecutive slices are identical, the UI warns that the page may not have loaded more content.

**F3 — Edit a record.** Options page → row → editor. Every changed field is logged with its old and new value. The image is immutable once saved.

**F4 — Delete a record.** Confirmation dialog → soft delete (§6.4). Logged.

**F5 — Export a case.** Options page → choose a case → **ייצוא ZIP**. The ZIP is built in memory and downloaded through a blob URL from the options page.

**F6 — Cases.** The side panel shows the current case and offers **תיק חדש**. Each case has its own running number.

## 6. Data model

### 6.1 Storage

IndexedDB database `social-evidence`, version 1.

| Store | Key | Notes |
|---|---|---|
| `cases` | `id` | |
| `records` | `id` | indexes: `caseId`; unique `[caseId, seq]` |
| `images` | `fileId` | PNG `Blob`; kept apart from records so lists do not load pixels |
| `auditLog` | `[caseId, n]` | one hash chain per case |
| `settings` | `key` | current case, sticky form values per case, last capture failure |
| `pending` | `id` (auto) | screenshots taken but not saved yet; cleared when the browser starts |

`chrome.storage` is not used.

### 6.2 Case

```ts
interface Case {
  id: string;         // uuid v4
  title: string;      // given by the user
  createdAt: string;  // ISO 8601 with offset
  nextSeq: number;    // starts at 1; only ever incremented
  auditCount: number; // number of audit entries in this case
  auditHead: string;  // hash of the newest audit entry; 64 zeros for an empty chain
  archived: boolean;
}
```

### 6.3 Record

```ts
type RecordType = 'post' | 'groupAdminPage' | 'profile' | 'other';
//                 פוסט  | עמוד מנהלי קבוצה | פרופיל   | אחר
type Platform = 'facebook' | 'tiktok' | 'instagram' | 'website';

interface EvidenceRecord {
  id: string;
  caseId: string;
  seq: number;                    // per case, 1-based, unique, never reused
  status: 'active' | 'deleted';   // soft delete, §6.4
  deletedAt?: string;             // ISO 8601 with offset, set on deletion
  recordType: RecordType;
  platform: Platform;
  url: string;                    // קישור — direct link to the post, as confirmed by the user
  pageUrlAtCapture: string;       // exact tab URL at the moment of capture; never edited
  capturedAt: string;             // e.g. 2026-11-18T14:03:22+02:00; never edited
  timeZone: string;               // IANA name, e.g. Asia/Jerusalem
  publishedAtText: string;        // תאריך הפרסום, as displayed on the page ("אתמול ב-14:20")
  publishedAt: string;            // optional, typed by the user: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"
  publisher: string;              // שם המפרסם
  groupOrPage: string;            // שם הקבוצה או העמוד
  groupAdmins: string;            // מנהלי הקבוצה, one per line
  echoes: string;                 // מהדהדים — profiles that shared the post, free text
  keyword: string;                // מילת מפתח
  notes: string;                  // הערות
  image: {
    fileId: string;
    fileName: string;             // derived from seq: "0007.png"
    sha256: string;               // of the final PNG bytes, strip included
    bytes: number;
    width: number;
    height: number;
    captureMode: 'visible' | 'fullpage';
  };
  extracted: {                    // what the adapter found, before any user edit
    adapter: Platform;
    adapterVersion: string;
    values: Partial<Record<'publisher' | 'groupOrPage' | 'url' | 'publishedAtText', string>>;
  };
  createdAt: string;
  updatedAt: string;
}
```

- `fileName` is the zero-padded `seq`: four digits minimum, wider only past 9999.
- Only the image with the strip is stored. The raw capture is not kept in v1.
- `publishedAt` is the wall-clock date as the user read it on the page. No timezone is claimed for it.
- `extracted.values` may hold `publisher`, `groupOrPage`, `publishedAtText` and `publishedAt`. It keeps what the page said even after the user corrects a field, so the two can be compared later.
- An adapter never changes the post link: `url` starts as the tab address and changes only when the user edits it.

### 6.4 Numbering, saving and deletion

IndexedDB transactions close as soon as the code waits for anything that is not a database request, so drawing and hashing cannot happen inside the transaction. Saving therefore works in two steps:

1. Read the case: `N = nextSeq`, `H = auditHead`.
2. Outside any transaction: draw the strip with number `N`, encode the PNG, compute its SHA-256, build the record and the audit entry (`prevHash = H`).
3. Open one read-write transaction over `cases`, `records`, `images`, `auditLog`:
   - re-read the case; if `nextSeq !== N` or `auditHead !== H`, abort and go back to step 1;
   - otherwise write image, record and audit entry, and set `nextSeq = N + 1`, `auditHead = entry.hash`.

Consequences:

- A cancelled or failed capture uses no number. Numbers have no gaps except from deletions.
- Two windows saving at the same moment cannot receive the same number.
- **Deletion** sets `status = 'deleted'` and `deletedAt`. The record and image stay in the database, the number is never reused, and deleted records are left out of the table and the images folder. Every export lists them in `deleted.csv` (§11), and the audit log records the deletion with the image hash. Both explain any gap in the exported numbering.

### 6.5 Audit log

```ts
interface AuditEntry {
  caseId: string;
  n: number;            // 1-based position in this case's chain
  at: string;           // ISO 8601 with offset
  action: 'case.create' | 'case.rename' | 'capture' | 'edit' | 'delete' | 'restore' | 'export';
  recordId?: string;
  seq?: number;
  imageSha256?: string; // on capture and delete
  changes?: Record<string, { from: string; to: string }>;  // on edit and rename
  details?: Record<string, string | number>;                // e.g. counts on export
  prevHash: string;     // hex; 64 zeros for the first entry
  hash: string;         // sha256 of the canonical JSON of all the fields above
}
```

- Every case starts its chain with a `case.create` entry. The case itself stores the chain's length and newest hash (`auditCount`, `auditHead`).
- `canonicalJson` sorts object keys recursively, writes no whitespace and accepts only plain JSON values. The hashed text is built from the known fields only.
- `verifyChain(entries, expected)` reports the first problem: numbering (`order`), a wrong pointer to the previous entry (`link`), content that does not match its hash (`hash`), or a chain that differs from what the case records (`head`).
- Writes use the same pattern as saving (§6.4): the entry is hashed first, and the transaction checks that the chain has not moved.
- The chain makes later changes **detectable**. It does not make them impossible: a person with access to the browser profile can rewrite the whole database. The chain has evidential value only if exported hashes are kept somewhere else (§10).
- An `export` entry is appended before the ZIP is built, so the exported log includes it.
- Stage 3 writes `case.create`, `case.rename`, `capture` and `export`. `edit`, `delete` and `restore` arrive with those features in stage 4.

## 7. Information strip (הטבעה)

- The strip is **appended below** the screenshot. It does not cover any pixel of the page.
- Height: 64 CSS px × device pixel ratio. It grows when a row is added or an address wraps.
- Row 1: the full tab URL at capture time (`pageUrlAtCapture`), labeled "כתובת הדף בעת הצילום". This is the factual address and always the main line.
- Row 2, only when the post link in the form differs from the tab URL: that link, labeled "קישור שהוזן ידנית".
- Last row: `#0007 · 2026-11-18 14:03:22 UTC+02:00 (Asia/Jerusalem) · FACEBOOK`
- Nothing is ever truncated: a row first shrinks its font down to a minimum size, then wraps.
- Text direction: addresses, numbers and dates are drawn as left-to-right runs. Each Hebrew label is its own right-aligned run, so mixed-direction text cannot reorder.
- Font: Noto Sans Hebrew (SIL OFL), bundled into the build from the `@fontsource-variable/noto-sans-hebrew` package, so the output does not depend on fonts installed on the machine.
- `layoutStrip(...)` computes lines, font sizes and strip height as a pure function. Drawing is a thin canvas wrapper around it.
- The strip's scale follows the device pixel ratio, derived from the screenshot size and the tab size.
- The SHA-256 covers the final PNG, strip included.

## 8. Capture mechanics

- **Visible area:** `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })`. It captures the viewport of an http(s) tab and nothing else.
- **Order of operations.** The screenshot always shows the page as it is displayed beside the side panel:
  1. `sidePanel.open()` is called first, synchronously in the event handler. Chrome accepts it only during the user gesture, and the gesture does not survive an `await`. Taking the screenshot first and opening the panel afterwards is therefore impossible. (Measured in stage 2: the call is refused after a 70 ms wait.)
  2. If the panel was closed, the capture waits until the tab's size has changed and stopped changing. A screenshot requested while the page is being resized fails with "image readback failed". (Measured: the page narrows about 350–400 ms after `open()` returns.)
  3. If the panel was already open, the screenshot is taken at once. The service worker finds this out by pinging the panel before opening it.
- **Rate limit:** Chrome allows two `captureVisibleTab` calls per second. Requests are spaced 600 ms apart, so a quick double press stays inside the quota. Full-page capture uses the same spacing between slices.
- **Image composition** (stitching, strip, PNG encoding, hashing) runs in the side panel page, not in the service worker. That page has a DOM, loads the bundled font reliably, and stays alive while the user works. The service worker captures and forwards the data.
- **Sticky headers** repeat in every slice of a full-page capture. This is accepted and documented. Hiding page elements would alter the page being documented.
- **Infinite or virtualized feeds** can lose or duplicate posts in a full-page capture. The README recommends the visible-area capture for feeds and the full-page capture for single long posts.
- **Service worker lifetime:** if the worker stops in the middle of a capture, nothing has been written and the user is asked to try again.

## 9. Metadata adapters

```ts
interface PageAdapter {
  id: Platform;
  version: string;                                    // bumped whenever selectors change
  extract(doc: Document, url: URL): ExtractedValues;  // publisher, groupOrPage, publishedAtText, publishedAt
}
```

- One file per platform under `src/adapters/`. Fixing a broken selector touches one file.
- **URL parsers are exact and pure**: `parseFacebookUrl`, `parseTikTokUrl`, `parseInstagramUrl` classify an address as a post, a group, a profile or neither. `isPostPermalink` uses them for the "one post, one page" warning in the form.
- **DOM readers are best-effort.** A field that is not found stays empty and the user fills it in.
  - `website`: `meta[name=author]`, `og:site_name`, `article:published_time`, JSON-LD (`author`, `datePublished`), `<time datetime>`.
  - `facebook`: author from the first heading link of the first article, group name from the link to the group's root, post date from the date link's label.
  - `tiktok`: the handle from the address; display name and date from `data-e2e` elements.
  - `instagram`: the handle from the address or the profile title; date from `<time datetime>`.
- **How it runs.** The readers are built into one self-contained file, `adapter.js`. After the screenshot, the service worker injects it into the captured tab with `chrome.scripting.executeScript`, in the extension's isolated world, and calls it once. There is no persistent content script. The reader only reads the rendered document: it does not click, scroll, expand or load anything, and it leaves nothing in the page's own JavaScript world.
- **The result is untrusted.** `sanitizeExtracted` keeps only the four known fields, only strings, removes control characters and direction-override characters, limits length, and accepts a normalized date only in its exact forms. The platform is the one the extension detected from the address, never the one the page claims.
- A machine-readable date with a timezone is converted to the wall-clock time of the viewing machine, because that is the time the page shows its reader.
- Test fixtures are **hand-written synthetic HTML**. No HTML saved from a real page enters the repository.
- **Limit:** the Facebook, TikTok and Instagram readers were written from the general structure of those pages and tested only on invented markup. They have not been checked against the live sites and will need tuning there. The form marks every value they produce so the user checks it.

## 10. Privacy, ethics and evidential limits

- Evidence exists only in IndexedDB on the device and in the ZIP files the user exports.
- Captures can contain personal data of other people. The README states that the user is responsible for lawful collection and handling, and that the extension does not redact anything.
- The owner has stated that the evidence may be used in a formal complaint or legal proceedings. The extension therefore states its limits plainly, in the README and in a `README.txt` inside every export:
  - The timestamp comes from the computer's clock. Nobody outside verifies it.
  - A SHA-256 shows that a file has not changed since it was hashed. It does not show that the page displayed that content.
  - Only what the user actually saw is captured. Login walls, deleted posts and regional blocks all affect that.
  - The audit chain has value only if the exported hashes are kept outside the device.
- The README gets a "Legal use" section in Stage 5: these limits, a recommendation to consult a lawyer about evidence rules and privacy law, and a short checklist (export early, keep copies off the device, keep the ZIP and its hashes together).
- The extension is not legal advice and makes no claim of admissibility.
- **v2, not v1:** external timestamping of an export's `hashes.txt` by a third party (for example an RFC 3161 service). It addresses the weakest point, the local clock. It would be the extension's first network call and needs its own decision.

## 11. Export

File name: `<case-slug>_<YYYY-MM-DD_HHmm>.zip`

```
images/0001.png …   numbered; matches מספר and שם הקובץ in the table
records.csv         UTF-8 with BOM, comma-separated, RFC 4180 quoting
records.xlsx        one sheet "רשומות", right-to-left view, frozen header row
deleted.csv         deleted records: seq, deletedAt, image SHA-256
audit-log.csv       the case's full audit chain, with prevHash and hash
README.txt          how to verify the hashes and the chain; the limits from §10
hashes.txt          SHA-256 of every other file, in sha256sum format
```

All of these are written since stage 3. `deleted.csv` holds only its header until deletion exists (stage 4).

- Columns, in this order: מספר, תאריך ושעת צילום, תאריך הפרסום, תאריך הפרסום (מנורמל), פלטפורמה, קישור, שם המפרסם, מהדהדים, שם הקבוצה או העמוד, מנהלי הקבוצה, מילת מפתח, סוג רשומה, הערות, שם הקובץ, SHA-256.
- "תאריך הפרסום (מנורמל)" is the one addition to the owner's column list. It holds the optional normalized date, next to the free text it belongs to.
- `deleted.csv` is written in every export, with a header row even when nothing was deleted.
- Capture times are ISO 8601 with offset in both files, so they do not depend on the locale of the machine that opens them.
- Formula-injection guard: a cell that begins with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'`.
- `hashes.txt` can be checked with `sha256sum -c hashes.txt`. It lists the hash of each file as exported. If an image no longer matches the hash stored at capture, the export still completes and the options page names the affected records.
- `audit-log.csv` has the columns `n, at, action, seq, imageSha256, prevHash, hash, entry`. `entry` is the exact text that was hashed, so a row can be checked with any SHA-256 tool: the hash of `entry` equals `hash`, and the `prevHash` inside it equals the previous row's `hash`.
- `deleted.csv` has the columns `seq, deletedAt, sha256`.
- `records.xlsx` stores every value as text (the running number as a number), so a spreadsheet never evaluates page text as a formula. The CSV uses the apostrophe guard instead.
- `README.txt` is UTF-8 with a byte order mark and CRLF line endings: the files, how to verify them, and the limits of §10.
- The ZIP is written one file at a time, so only one image is in memory at once.
- Column headers and value names come from the locale file, like every other user-facing string.
- Libraries: `fflate` for ZIP. The XLSX is written directly as SpreadsheetML inside a ZIP, which avoids a heavy spreadsheet dependency. Because it is written by hand, all text is XML-escaped and stripped of characters XML does not allow.

## 12. Options page

Implemented in stage 3:

- **Cases home.** Every case is a card: name, number of records, last capture, creation time. Actions: open, rename, make active, archive and restore. The active case, where new captures go, is marked and cannot be archived.
- **Case view.** The records in a table, a preview of each image inside the page, **ייצוא ZIP**, and **בדיקת שלמות**.
- **Integrity check.** Re-hashes every stored image, verifies the audit chain against the case, and checks that every record has a matching `capture` entry. It reports missing images, changed images, records that the log does not know, and the position where the chain breaks.

Stage 4 turns the case view into the dashboard the owner chose:

- A summary row: records, per platform, per record type, top keywords, last capture.
- Search across the text fields. Filters: platform, record type, capture-date range, deleted or not.
- The table with thumbnails, 100 rows per page.
- A side editor: all fields, the image, and that record's audit history. Delete with confirmation.
- An interactive mockup is approved by the owner before this screen is built.

## 13. Side panel form

- Case selector at the top, with **תיק חדש**. Switching the case changes where the next capture is saved, the running number and the sticky values.
- Fields from §6.3. Record type defaults to "פוסט".
- **Fields read from the page** (publisher, group or page, publication date, normalized date) carry a "מהדף" badge and a line asking the user to check them. Editing a field removes its badge.
- **Permalink warning:** when the record type is "פוסט" and the tab address is not a single post on Facebook, TikTok or Instagram, the form says so and repeats the workflow rule. It does not block saving.
- Publication date: a free-text field for the date as the page shows it, and an optional normalized date with an optional time. A time without a date is rejected.
- **Sticky fields:** record type, group or page name, group admins and keyword keep their last saved values for the next capture. They are marked "קבוע" in the form. One button, **ניקוי השדות הקבועים**, resets all four. The values are stored per case in `settings` and survive closing the panel. A group name read from the current page takes precedence over the sticky one.
- Image preview with the strip and the provisional number. The preview is redrawn when the post link changes, because the link can add a row to the strip.
- Buttons: **שמור**, **ביטול הצילום**, and from stage 4 **צילום עמוד מלא**.
- A new capture while typed details are unsaved asks before replacing them. Discarding typed details asks too.
- While no capture is waiting, the panel shows the workflow rule and the number of saved records.

Language: the UI is Hebrew and right-to-left. All strings go through `chrome.i18n` with `default_locale: "he"`. Adding English later means adding `_locales/en/messages.json`. Page direction comes from a `uiDir` message in the locale file. `@@bidi_dir` is not used: it follows the browser's language, which can differ from the locale Chrome falls back to.

## 14. Permissions

| Permission | Why it is needed |
|---|---|
| `activeTab` | Capture the visible tab and run a script in it. Chrome grants it only when the user clicks the icon or presses the shortcut, and only for that tab. |
| `scripting` | Run the metadata reader, and from stage 4 the full-page scroll step, in the current tab. Without host permissions it works only on a tab that `activeTab` has just opened up. |
| `sidePanel` | Show the form beside the page. A popup would close as soon as the user clicks the page. |
| `unlimitedStorage` | Hundreds of PNG screenshots can exceed the default storage quota. |

- **No host permissions.** No `<all_urls>`, `tabs`, `storage`, `downloads`, `cookies`, `history` or `webRequest`. No declared content scripts and no web-accessible resources.
- **Content security policy:** `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
- `externally_connectable` with an empty list: no other extension and no web page may send messages to this one.
- Commands: `capture-visible` (`Alt+Shift+S`) and, from stage 4, `capture-full-page` (`Alt+Shift+F`). The user can change both at `chrome://extensions/shortcuts`.
- `minimum_chrome_version`: 116 (side panel can be opened from a user gesture).
- `npm run check:build` fails when the built manifest differs from this section. See §21.

## 15. Architecture and folders

```
Social-evidence/
  README.md  SPEC.md  SECURITY.md  LICENSE
  docs/guide.he.md                  installation and usage guide in Hebrew
  docs/images/guide/                its screenshots (invented data)
  package.json  .npmrc  tsconfig.json  vite.config.ts  vite.adapter.config.ts  vitest.config.ts
  assets/icon.svg                   source of the icons
  scripts/check-build.mjs           security check of the built extension
  .github/workflows/ci.yml          typecheck, tests, build, build check, audit
  .github/workflows/release.yml     builds and publishes the ZIP for a version tag
  public/
    manifest.json
    _locales/he/messages.json
    icons/
  src/
    background/service-worker.ts    icon click and shortcut, side panel, screenshot, page reader
    capture/data-url.ts             (stage 4: fullpage.ts, stitch.ts)
    watermark/layout.ts  draw.ts
    platform/detect.ts
    adapters/types.ts  dom.ts  website.ts  facebook.ts  tiktok.ts  instagram.ts
             permalink.ts  sanitize.ts  index.ts  inject.ts
    domain/types.ts  numbering.ts  time.ts  hash.ts  csv.ts  table.ts  record.ts
           canonicalJson.ts  audit.ts  xlsx.ts  export.ts  integrity.ts
    db/idb.ts                       schema, cases, audit chain, the save transaction of §6.4
    shared/i18n.ts  labels.ts  messages.ts  base.css
    sidepanel/index.html  main.ts  panel.css
    options/index.html  main.ts  options.css
  test/                             unit tests and invented fixtures
  demo/                             GitHub Pages demo (stage 4)
```

- **Pure modules** (no `chrome.*`): `detect`, `numbering`, `time`, `hash`, `csv`, `table`, `record`, `canonicalJson`, `audit`, `xlsx`, `export`, `integrity`, `watermark/layout`, `adapters/sanitize`, `adapters/permalink` and the URL parsers. The DOM readers need only a `Document`.
- **Build:** two Vite builds. The main one has three entries (service worker, side panel, options page) and copies the manifest. The second builds `adapter.js` as one self-contained classic script, because it is injected into a page. TypeScript strict. Node 20 or newer.
- **Dependencies:** two at runtime (`fflate`, the font package). Versions are pinned exactly and install scripts are disabled (`.npmrc`).
- **Font:** the font files come from the `@fontsource-variable/noto-sans-hebrew` package and are bundled by Vite. No font binary is committed.
- **Demo page:** an invented social network with invented people and posts, in its own neutral design. It does not imitate the look of a real platform. It carries `og:` tags and `<time>` elements so the `website` adapter has something to extract. README screenshots and the GIF are recorded on this page only.

## 16. Testing

Vitest unit tests (227 at the end of stage 3):

- `detectPlatform`: subdomains, lookalike hosts, mixed case, query strings, non-http schemes.
- CSV: BOM present, quoting of commas, quotes and newlines, Hebrew text, formula guard.
- Numbering and file names: sequence, padding, width past 9999, no reuse after deletion.
- SHA-256: published test vectors.
- `layoutStrip`: nothing is truncated, shrink before wrap, the manual-link row, labels, strip height.
- `time`: ISO formatting with offset across a daylight-saving change.
- `canonicalJson` and the audit chain: a valid chain verifies; a changed, re-hashed, removed, reordered or cut-off entry is detected.
- XLSX: escaping, characters XML forbids, well-formed XML with hostile text, numbers and inline strings, right-to-left, frozen header.
- Export: every file present, `hashes.txt` matches the files, the audit table verifies with plain SHA-256, deleted records, a changed image is reported.
- Integrity check: changed image, missing image, forged record, forged log entry, shortened log.
- `sanitizeExtracted` and `isRuntimeMessage` / `isTrustedSender`: hostile and malformed input.
- URL parsers for the three platforms, and the adapters on invented pages (jsdom).
- Storage on an in-memory IndexedDB: cases, the audit chain under concurrent writes, and two saves racing for one number.

End-to-end: stages 2 and 3 were checked in headed Chromium with the unpacked build, triggered by the real keyboard shortcut (and in stage 2 also by a real click on the toolbar entry). The stage 3 run made 47 checks: page details read and marked, sticky values, two cases with independent numbering and chains, the permalink warning, requests from the side panel and the service worker blocked by the CSP, rename, integrity check, export verified outside the extension (`sha256sum -c`, the XLSX opened with a spreadsheet library, the audit chain recomputed), and tampering with an image and with a log entry reported. The script is not part of the repository yet; whether it joins as an automated test is decided in stage 5.

Not tested anywhere: the Facebook, TikTok and Instagram readers on the live sites.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Facebook, TikTok and Instagram change their DOM often and use generated class names | Adapters are isolated and versioned; the version is stored on every record; the form is always editable; page-read fields are marked for checking |
| The readers for the three platforms are unverified on the live sites | Stated in §9 and the README; to be tuned by the owner on real pages |
| A wrong value read from the page is saved unnoticed | The "מהדף" badge and hint; the original page value is kept on the record next to the saved one |
| Chrome applies its own default font and size to the body of extension pages | Font and size are set on the body itself (found by the stage 3 end-to-end check) |
| Development tools carry a known advisory (`picomatch`, via Vite and Vitest) with no compatible fix | Not shipped: the runtime dependencies have no known vulnerability. CI fails only on runtime findings and prints the rest |
| `captureVisibleTab` captures only the viewport, about twice per second | 600 ms pacing; full-page capture is a separate, explicit action |
| Opening the side panel narrows the page and needs a live user gesture | Settled in stage 2: the panel opens first, the capture waits for the page to settle, and every screenshot shows the page beside the panel (§8). Keeping the panel open while documenting avoids the wait |
| `activeTab` is granted by the icon and shortcuts, not by buttons inside the side panel | Every capture starts from the icon or a shortcut. Confirmed in stage 2 for both. A panel button (stage 4) reuses the grant of the current tab, and asks for the shortcut if the grant is gone |
| A second capture arrives while typed details are unsaved | The panel asks before replacing them |
| Download file name with Hebrew letters | Works on a UTF-8 system. On a system with a non-UTF-8 locale Chrome falls back to the name "download" (seen in the test container) |
| Full-page capture on feeds loses or duplicates posts | Duplicate-slice warning; height cap; guidance in the README |
| Sticky headers repeat in slices | Accepted and documented |
| The computer's clock may be wrong | Offset and timezone on every capture; stated in §10; external timestamping considered for v2 |
| Hebrew and mixed-direction text on canvas | Bundled font; separate left-to-right runs; checked visually in stage 2 |
| Data loss when the extension is removed or the browser profile is cleared | Export reminder in the UI; stated in the README |
| Storage size in large cases | `unlimitedStorage`; case size shown in the UI |
| CSV and XLSX formula injection from page text | Guard in §11 |
| Personal data of other people in captures | §10; README ethics section |
| Expectations about admissibility | §10; no legal claims anywhere |

## 18. Stages

1. **Specification** and open questions → approved.
2. **MVP:** visible capture, strip, form with manual fields, one case, ZIP with images and CSV → done, published.
3. **Security hardening, adapters, several cases, XLSX, hashes file, audit log, integrity check** → done.
4. **Full-page capture, the case dashboard with editing and deletion, demo page.**
5. **README with cover image and GIF, tests complete, cleanup.**

Commits follow the stages. Each stage is pushed to GitHub only after its summary is approved.

**Releases and the user guide** (added after stage 3):

- A version tag `vX.Y.Z` runs `.github/workflows/release.yml`: the same checks as CI, then `social-evidence-X.Y.Z.zip` (the contents of `dist/` at the archive's root) and its `.sha256` are published as a GitHub Release. The tag must match the version in the manifest. No third-party action is used.
- `docs/guide.he.md` is the installation and usage guide in Hebrew, with screenshots taken on an invented page. It quotes the interface texts from the locale file and Chrome's own Hebrew labels as read from the browser. It is the one document in Hebrew; the README, this specification and `SECURITY.md` stay in English.
- Chrome ties an unpacked extension's storage to the folder it is loaded from. Checked: replacing the files in the same folder keeps the saved cases; loading the same build from another folder starts empty; removing the extension deletes its data. The guide's update instructions follow from this.

## 19. Decisions

Made by the owner:

- The evidence may be used in a formal complaint or legal proceedings (§10).
- Full-page capture may scroll the current page, under the limits in §3.
- Only the image with the strip is stored.
- Soft delete; numbers are never reused. Deleted records are listed in `deleted.csv` as well as in the audit log.
- The strip's main line is the tab URL. A differing post link gets its own row, labeled as entered manually.
- Workflow rule: open the post on its own page before capturing (§5).
- Publication date: free text as shown, plus an optional normalized date.
- Sticky fields with a one-click clear button (§13).
- Noto Sans Hebrew for the strip and the UI.
- Repository: `matnael332/Social-evidence`, public from stage 2. The project is named Social Evidence everywhere (working name until stage 2: post-evidence-capture).
- Commit messages carry no AI credit lines.
- Metadata is read from the page (§9), which adds the `scripting` permission.
- The form stays in the side panel.
- Stage 4 management screen: a home of case cards, and inside a case a summary row above the table with a side editor (§12).

Defaults, open to change:

- Code, comments, README and this SPEC in English. UI in Hebrew.
- The form lives in the side panel, and screenshots show the page beside it (§8).
- The table has one column beyond the owner's list: "תאריך הפרסום (מנורמל)".
- Commits are authored as `matnael332` with GitHub's no-reply address, so no private email enters the history.
- Audit chain per case; `audit-log.csv` and `README.txt` are part of every export.
- Shortcuts `Alt+Shift+S` and `Alt+Shift+F`.
- MIT license.

## 20. Open questions

None at the moment. The questions of v0.1 are answered in §19.

## 21. Security model

**What the extension can do.** After the user clicks its icon or presses its shortcut, on that tab only: take a screenshot of the visible area and run its own reader script in the page. At all times: read and write its own local database. Nothing else.

**What it cannot do.** It has no host permissions, so it cannot read or change any page the user did not ask it to capture, and it cannot act in the background. It cannot read cookies, history or other extensions' data. Its content security policy forbids every outbound request from its pages and its service worker.

**Threats and what answers them.**

| Threat | Answer |
|---|---|
| A page tries to inject code or markup through its content | The UI writes text only, never HTML. Page data passes `sanitizeExtracted`. CSV has a formula guard; XLSX stores text and escapes XML. File names inside the ZIP come from running numbers only |
| A page or another extension sends messages to the extension | `externally_connectable` is empty. Every listener checks that the sender is the extension's own origin and that the message has a known shape |
| A dependency turns malicious | Two runtime dependencies, pinned exactly, install scripts disabled. The CSP blocks requests even from code that got in. `npm run check:build` fails on any network API, remote address or code evaluation in the build |
| A malicious update is pushed to users | The extension is not distributed through a store and has no update channel. Users install a build they made or chose |
| A change quietly widens the permissions | `npm run check:build` compares the built manifest with the agreed permissions and CSP, and CI runs it on every push |

**What it cannot protect against.**

- **Access to the computer.** The database is not encrypted. Anyone who can use the user's account on the computer, including malware, can read and change the stored cases. Disk encryption, a separate browser profile for this work, and regular exports kept elsewhere are the answer.
- **A tampered copy.** Someone who installs a build from another source trusts that source. A build with `scripting` that was altered could act as the user on the tab they capture, at that moment.
- **Navigation.** The CSP blocks requests, not navigation. It is one layer, not a guarantee.
- **The limits of §10**: the local clock, and what a hash does and does not show.

`SECURITY.md` repeats this for users and says how to report a problem.
