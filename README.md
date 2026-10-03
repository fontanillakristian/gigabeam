# PDF Viewer & Editor

A fast, private PDF viewer and markup editor that runs entirely in the browser. Nothing is uploaded: files are opened, edited and saved on your own machine.

Built for drawings and plan sets, but it works on any PDF.

## Features

- **View** big files quickly: page 1 appears in well under a second even for 800+ page sets, pages and thumbnails render lazily, and progress is shown while opening.
- **Markups:** text boxes, callouts, lines, rectangles, ellipses, polygons, polylines, revision clouds, highlighter, images and signatures. Every markup is saved as a real PDF annotation, so it stays editable in this editor and visible in other viewers.
- **Measure:** calibrate a scale (or pick a template), then measure lengths and areas. Labels can be replaced with your own text.
- **Text:** select and copy page text (Select text tool, X), and **Find** (Ctrl+F) with highlighted results.
- **OCR:** recognize the text of scanned pages (Document > Recognize text), offline, English. Saving writes it into the PDF as invisible text, so the file becomes searchable anywhere.
- **Other programs' markups and form fields** are shown and kept when saving.
- **Forms:** checkbox, radio button and dropdown fields (real AcroForm fields), editable in a tabbed Properties panel and fillable in place.
- **Detect form fields** (Forms > Detect fields): finds the blanks of a non-fillable form (lines, underscores, empty boxes and table cells, small squares) and suggests blank text boxes and checkboxes, named from nearby labels. You review the suggestions first. Works on scanned forms too (run OCR first for best results).
- **Document tools:** rotate, crop, insert / delete / reorder pages, insert another PDF.
- **Page numbers, header & footer, watermark** (text or image, over / blend / behind the page).
- **Bookmarks:** read from and written to the PDF outline.
- **Flatten / unflatten:** bake markups into the page, optionally keeping them restorable.
- **Multiple tabs**, a Markups list, command search (`Ctrl+K`), and keyboard shortcuts.
- **Undo / redo** covers everything: markups, form fields, page numbers, header & footer, watermark, bookmarks, and page operations (delete, insert, reorder, rotate, crop, flatten, unflatten).
- Works on narrow windows too: the side panels float over the canvas instead of squeezing it.
- **Touch and pen:** draw, drag and pinch-zoom with a finger or stylus.
- **Unsaved-changes prompt:** closing a tab or the browser asks whether to save first (Save uses the Save As dialog in Chrome/Edge, otherwise it downloads). File > Save PDF as… (Ctrl+Shift+S) always asks where.
- **Saving and page operations run in a background worker**, so the window stays responsive on big files.
- Form fields keep a default value separate from the current value, with Reset buttons.

## Running it

It is a static site: no build step, no dependencies to install.

```bash
# from this folder, any static file server works, for example:
npx serve .                    # Node
python -m http.server 8080     # Python
# or use the "Live Server" extension in VS Code, then open the address it prints
```

You can also open `index.html` directly from disk. The app works, but the browser blocks it from loading `assets/icons/*.svg`, so it falls back to the built-in icon set (see below).

The PDF libraries ([pdf.js](https://mozilla.github.io/pdf.js/) 3.11.174 and [pdf-lib](https://pdf-lib.js.org/) 1.17.1) and the signature fonts are bundled in [`vendor/`](vendor) with their licenses, so the app works fully offline and makes no network requests. To update one, replace the file in `vendor/` and keep its name.

### Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `V` | Select / Move | `Ctrl+O` | Open |
| `H` | Pan | `Ctrl+S` / `Ctrl+Shift+S` | Save / Save as |
| `X` | Select text | `Ctrl+F` | Find |
| `T` `C` `L` `R` `E` | Text, Callout, Line, Rectangle, Ellipse | `Ctrl+P` | Print |
| `Shift+H` | Highlighter | `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Esc` | Cancel the current tool | `Ctrl+K` | Search commands |

## Project layout

```
index.html              page structure (all markup lives here)
css/styles.css          all styles; design tokens are the CSS variables at the top
assets/icons/           one SVG per UI icon, plus icons.json (the list)
js/boot.js              start-up: builds the icon sprite, then loads the scripts below in order
js/icons-fallback.js    built-in copy of the icons, used only if the icon files can't be fetched
js/*.js                 the application (see "Code structure")
vendor/                 bundled third-party libraries and fonts, with their licenses
tools/                  helper scripts
```

## Replacing the icons

Every UI icon is a separate file in [`assets/icons/`](assets/icons). To change one, replace the file and keep its name: `open.svg`, `save.svg`, `undo.svg`, and so on.

- Icons are drawn on a 24×24 grid using `stroke="currentColor"`, so they pick up the theme colours. If you supply your own artwork, keep `currentColor` (or `fill="currentColor"`) where you want it to follow the theme.
- To add an icon, drop `name.svg` in the folder, add `"name"` to `assets/icons/icons.json`, and use it in markup as `<svg class="i"><use href="#i-name"/></svg>`.
- The icons load with `fetch`, which needs the site served over `http(s)`. When opened straight from disk the built-in set in `js/icons-fallback.js` is used instead; regenerate it after changing icons with:

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-icon-fallback.ps1
```

## Code structure

The app is plain JavaScript (no framework, no bundler). The files are ordinary scripts that share one global scope and are loaded in order by `js/boot.js`, so **the order in `boot.js` matters**: a file may only run code at load time that references things defined in files listed before it. Anything that only runs later (inside a function or event handler) can reference any file.

| File | What it does |
| --- | --- |
| `state.js` | constants, DOM references, shared state |
| `platform.js` | the only file that knows if it runs in a browser or the desktop app: open / save dialogs, closing the window |
| `utils.js` | page geometry (rotate / crop), image store, revision-cloud outline, undo / redo, simple modals |
| `documents.js` | opening files, importing saved markups, tabs |
| `pages.js` | page stack, lazy page rendering, thumbnails, page operations |
| `overlay.js` | drawing shapes, callouts, text boxes, selection and dragging |
| `tools.js` | drawing and measuring gestures |
| `properties.js` | Properties panel, defaults, delete / paste, tool switching, zoom |
| `dialogs.js` | dialog helper, scale, rotate, crop, images, signatures, flatten dialog |
| `export.js` | saving (markups become PDF annotations), download, print |
| `ui.js` | toast, loading progress, fast parsing helpers, background import |
| `markups-list.js` | the Markups list panel |
| `bookmarks.js` | bookmarks (import, edit, write `/Outlines`) |
| `forms.js` | form fields and the sectioned Properties layout |
| `flatten.js` | flatten / unflatten |
| `layout.js` | page numbers, header & footer, watermark: data model, live overlay, PDF export |
| `layout-dialog.js` | the tabbed Page layout dialog for those three |
| `ocr.js` | text recognition (Tesseract.js) and writing the recognized text into the saved PDF |
| `text.js` | the selectable text layer, the Select text tool, and Find |
| `detect.js` | Detect form fields: reads lines, boxes and text (or the page image on scans) and shows suggestions for review |
| `core.js` | the heavy PDF work (save, print, page operations, flatten, inspect) as plain functions |
| `worker-api.js` | `heavy()`: runs a `core.js` function in the background worker, or on the main thread if no worker is available |
| `pdf-worker.js` | the worker; loads pdf-lib and the same app scripts against a stubbed DOM |
| `touch.js` | touch / pen input: turns pointer events into the mouse-driven tools, pinch zoom |
| `shell.js` | toolbar tabs, panels, status bar, menus, command search, shortcuts |
| `init.js` | first paint |

### How data is stored

- Markups live in memory as plain objects per page, positioned as **fractions of the visible page**, so they survive zooming, rotating and cropping.
- On save, each object is written as a real PDF annotation *and* tagged with the exact object as JSON (`/CEK`, `/CED`). Re-opening a file saved here restores fully editable objects.
- Page numbers, header/footer and watermark settings are stored in the catalog (`/CELayout`); the watermark itself is a tagged content stream (`/CEWM`). Flattened pages carry a tagged stream (`/CEFL`) so they can be unflattened.
- Files this editor did not write skip all of that, which is why other PDFs open instantly.

## Browser support

Current versions of Chrome, Edge, Firefox and Safari.

## Known limitations

- Saving and page operations rewrite the whole file (about 4 seconds for a 15 MB / 842-page file). This runs in a background worker, so the window stays usable; the status bar shows it is working.
- Only the five most recent page operations can be undone (each keeps a copy of the file as it was); markup-level undo goes back 60 steps.
- "Behind page content" watermarks are hidden by opaque scanned pages; use "Blend with page" for scans.
- Touch and pen input has been tested with simulated events only, not on real devices.
- Saved annotations and form fields have been checked with pdf.js only, not Acrobat or Bluebeam.
- Field detection is a best guess: expect to discard a few suggestions and add a few by hand, especially on dense or skewed scans and on drawing sheets.
- OCR is English only and does not read handwriting. Text pages take about 3–5 seconds each; dense drawing sheets 20–60 seconds. Words it is unsure of (under 40% confidence) are left out. Other programs' markups and form fields are shown and kept, but can't be edited here.

## License

Copyright (C) 2026 Kristian Carl B. Fontanilla

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License v3.0](LICENSE) as published by the Free Software Foundation. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

The PDF libraries it loads, pdf.js (Apache 2.0) and pdf-lib (MIT), keep their own licenses.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md); every commit needs a `Signed-off-by` line (`git commit -s`).
