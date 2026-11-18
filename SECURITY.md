# Security

Social Evidence handles material that can be sensitive, so this page says plainly what the extension can do, what protects you, and what does not.

## What the extension can do

- **When you click its icon or press its shortcut, on that tab only:** take a screenshot of the visible area, and run its own reader in the page to pick up the post's details. The reader only reads; it does not click, scroll or load anything.
- **At any time:** read and write its own local database in your browser.

That is all. It has no access to any other tab, to your cookies or history, or to other extensions, and it cannot act in the background.

## What protects you

| Risk | Protection |
|---|---|
| The extension sends your data somewhere | Its content security policy forbids every outbound request from its pages and its service worker (`connect-src 'none'`). The build check fails if the build contains network code or a remote address. |
| A web page attacks the extension through its content | Text from pages is always shown as text, never as markup. Details read from a page are reduced to four known fields, stripped of control and direction-override characters, and limited in length. The CSV neutralizes formulas; the XLSX stores text only. |
| A page or another extension sends it commands | No web page and no other extension may connect to it. Internal messages are accepted only from the extension's own origin and only in known shapes. |
| A dependency is compromised | Two runtime dependencies, pinned to exact versions, with install scripts disabled. Even code that got in could not make a request. |
| A malicious update reaches users | There is no update channel. The extension is not distributed through a store; you install a build you made, or a release ZIP you chose and can verify. Nothing updates by itself. |
| A change widens the permissions unnoticed | `npm run check:build` compares the built manifest with the agreed four permissions and the content security policy, and runs in CI on every push. |

## What does not protect you

- **Access to your computer.** The stored cases are not encrypted. Anyone who can use your account on the computer, including malware, can read and change them. Use disk encryption, consider a separate browser profile for this work, and keep exports somewhere else.
- **A copy from somewhere else.** If you install a build that is not from this repository, you trust whoever made it. A modified build could act as you on the page you capture, at the moment you capture it.
- **The audit log by itself.** It makes later changes detectable, not impossible. Someone who can rewrite the whole database can rebuild the log. It is worth something only together with a copy of an export's `hashes.txt` kept outside the computer.
- **The clock.** Timestamps come from your computer's clock and are not verified by anyone.
- **Navigation.** The content security policy blocks requests, not navigation to another page. It is one layer of defence, not a guarantee.

## Verifying a release

Each release on GitHub holds `social-evidence-<version>.zip` and a `.sha256` file. Both are produced by the release workflow in this repository (`.github/workflows/release.yml`) from the tagged commit, after the type check, the tests, the build check and the audit of shipped dependencies have passed. To check a download:

```bash
sha256sum -c social-evidence-<version>.zip.sha256
```

To be independent of the published ZIP altogether, build from source: `npm ci && npm run build` gives the same extension in `dist/`.

## Known advisories

`npm audit --omit=dev` reports no known vulnerability in what the extension ships. The development tools (Vite and Vitest) depend on a package with an open advisory and no compatible fix; it affects the build machine only and is not part of the extension.

## Reporting a problem

Please report a vulnerability privately through the repository's **Security** tab ("Report a vulnerability"). If that option is not available, open an issue that says only that you have a security report, without the details, and a private channel will be arranged.
