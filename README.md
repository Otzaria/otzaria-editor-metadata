# Otzaria metadata editor

Open `index.html` directly in a browser. The editor, its CSS, and the normal
variable-weight Inter font are contained in that one file; opening it, editing
metadata and saving JSON require no network connection.

The **Download application** button saves a fresh copy of the editor, including
its styles and fonts. It starts with an empty editor when reopened, even if the
download was made after editing or searching. Use the existing **Save/download
JSON** button to save the metadata itself; that download retains the original
JSON filename and includes all rows, including those hidden by a search.

## Updating the styles

Tailwind CSS **3.4.17** matches the version of the original embedded stylesheet.
It runs only during development. The build scans `index.html`, including the
JavaScript string literals used by `className` and `classList`, so styling for
dynamically created controls is available before any JSON file is loaded.

```sh
npm ci
npm run build:styles
npm run check:styles
```

Commit the updated `index.html` along with source changes. Keep complete utility
class names in the HTML/JavaScript instead of constructing names from fragments.
The generated `<style id="compiled-styles">` block is excluded from its own
content scan, so repeated builds produce identical output. Edit application
classes or the build script, then rebuild; do not edit the generated block.

The build embeds all seven normal Inter language subsets from the pinned
`@fontsource-variable/inter` package. The original `Inter, sans-serif` stack and
100–900 weight range are preserved; Hebrew continues to use the system fallback.
Embedding the fonts increases the standalone HTML size but preserves font
coverage without a Google Fonts request. The font's SIL Open Font License and
Tailwind's MIT license are included in the generated block and therefore in
every downloaded copy of the application.

The existing fixed 1000px layout, colors and editor behavior are retained.
There is no CSS runtime, remote font import or separate CSS/font file to copy
alongside a downloaded editor. Network access is needed to install build/test
dependencies, not to use the resulting HTML.

An unused initializer copied from the hosting environment has been removed. It
assigned authentication/configuration globals that the editor never reads;
these values do not belong in a standalone application or its downloaded copy.
The remaining host instrumentation is unchanged. The offline test checks both
the source and exported HTML for that initializer and embedded credential
patterns without printing any matched values.

## Offline regression check

```sh
npm ci
npx playwright install chromium
npm test
```

`npm test` first verifies the committed build and then opens the real HTML with
Chromium's network disabled. It checks all embedded fonts, dynamic selection,
hover and form styles, editing several JSON types, filtering, exporting all
rows, and downloading the app after editing/searching. It reopens that downloaded
HTML, imports another file and exports a second edit. It also checks the existing
fixed-width layout on a small viewport and requires zero external requests or
browser errors.

Screenshots and the test report are written to ignored `test-results/`.
`CHROMIUM_PATH` can select an already installed browser; `CHROMIUM_ARGS` can
supply a JSON array of extra launch arguments when required by a test container.
