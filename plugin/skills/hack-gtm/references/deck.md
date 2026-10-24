# HTML deck

This deck is for presenting from a laptop or printing to PDF, so it has to be a single self-contained HTML file: inline CSS, inline JS, images as relative paths in the same folder (or base64 for one file). No CDN fonts, no frameworks. Start from `assets/deck-template.html` and save it as `launch/deck/index.html`. It stays out of the public repo with the rest of `launch/` (SKILL.md, non-negotiable 8), because its proof image comes from an evidence pack.

What the site scores: a deck at a "hosted or shared link" (problem, build, Kane in the loop, demo, what is next). The site's own deck is `/ship/<team>/deck`, which opens once a teammate publishes the Ship Page; the team edits its slides in the Studio (`/studio/<team>/deck`). The site never shows custom HTML, so this local file scores nothing on its own. Reuse its slide text in the Studio deck.

## Assets next to index.html

The template points at files nothing creates for you:

- `hero.png`: copy the brief's `hero` image, one the person has approved.
- `fail-annotated.png`: copy the failed step's screenshot, only after the person has looked at it and said yes (with `--include-screenshots` the video script puts them in `launch/video/steps/`).
- The demo slide plays `../video/showcase.mp4`, which exists only after the video is rendered (SKILL.md, step 5a).
- How it works is drawn in HTML in the template; there is no image to make.

Before opening or printing the deck, delete any `<img>` or `<video>` whose file isn't there, and drop a slide that is left with nothing to show (the demo slide with no video or screenshots). Put it back when the file exists. A broken image on a projector is worse than one slide fewer.

## Slide list (10)

| # | Slide | Content | Rule |
|---|---|---|---|
| 1 | Title | Project name, one-line pitch, team, "Kane CLI Hack Day, <date>" | One sentence of text beyond the name |
| 2 | Problem | One scene, one sentence, one image or number | No bullet list |
| 3 | What we built | The pitch expanded to three short lines, hero screenshot | Screenshot takes 60% of the slide |
| 4 | Demo | `../video/showcase.mp4` (muted, loop) or three approved screenshots | If video, add a poster image for print |
| 5 | How it works | One diagram: user, app, OpenAI layer, Kane CLI loop, drawn in HTML | Four boxes max, labelled arrows |
| 6 | Built with OpenAI | Model, API surface, what it owns, one tradeoff | Three lines |
| 7 | Tested with Kane CLI | Left: annotated screenshot of the failed step with the error line. Right: the passing run totals from `run.yaml`. Bottom: what Kane checked, in one line | This is the proof slide; every element traces to the pack, and the pack itself stays private |
| 8 | What we learned | Three honest lines | No "key takeaways" heading |
| 9 | What's next | Three lines | The site's deck rubric asks for it |
| 10 | Team and links | Names, handles, repo, Ship Page, deck URL, QR optional | |

## Design rules

- One idea per slide. If a slide needs a second box, it is two slides.
- No stacked rows of bordered boxes. Diagrams use at most four nodes.
- Type: headline 56 to 72px, body 28 to 36px at 1920x1080. If a line of body text wraps twice, cut it.
- Dark background, one accent colour, white text. Keep the TestMu AI and OpenAI wordmarks as text unless the event brand kit says otherwise.
- Presenter flow: each slide's headline should read as the next sentence of the story when you read headlines alone, top to bottom.

## Technical

- Keyboard: left/right arrows, space, and swipe navigate. `?` toggles a help overlay. `p` toggles print mode (all slides stacked, page-break-after each) so Cmd+P produces a PDF for the LinkedIn document post.
- URL hash `#5` opens slide 5.
- `<meta name="viewport">` and a scale transform so it fits phones.

## Export

- PDF: print mode then browser print to PDF, 16:9 custom page size.
- Images for the carousel: Playwright screenshot of each slide at 1920x1080 (`scripts/remotion` does not do this; use a 10-line Playwright script if asked).
