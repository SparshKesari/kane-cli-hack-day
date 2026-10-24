---
name: hack-gtm
description: Launch kit for a hackathon project built with OpenAI and tested with Kane CLI. Takes a project brief (idea, description, how Kane CLI was used, repo, Ship Page, evidence pack) and produces everything needed to ship it publicly: X thread and LinkedIn post that tag TestMu AI and OpenAI and read human, a Show HN post, a launch blog with sections (what it is, use cases, how it was built, where Kane CLI added value), an HTML deck, and an MP4 showcase video with voice-over rendered from the Kane CLI evidence pack via Remotion or ffmpeg. Use this whenever a participant or organizer says "launch", "ship", "GTM", "announce", "write the post", "make the deck", "make the video", "$hack-share", "$hack-ship" or "$hack-deck", or hands you a finished hackathon project and asks what to do next.
---

# hack-gtm

Turn a finished hackathon build into a public launch. One input (the project brief), six outputs, each written so it could pass as the builder's own work.

## Inputs

Collect these before writing anything. Ask once, in one message, for whatever is missing. `assets/brief-template.md` is the form; paste it to the user if they have nothing yet.

| Field | Why it matters |
|---|---|
| Project name, one-line pitch, longer description | Everything hangs off the pitch |
| Problem and who has it | Opens the blog and the LinkedIn post |
| What was built with OpenAI (model, API, Codex, Agents SDK, Realtime, etc.) | "Built with OpenAI" claim must be specific and true |
| How Kane CLI was used: commands run, what was asserted, bugs it caught, number of runs, pass/fail history | This is the story. Vague "we tested it" is not usable |
| Repo URL and submitted SHA | Ship Page and HN both need it |
| Ship Page URL and deck URL (`/ship/<team>` and `/ship/<team>/deck` per the Hack OS reference) | Mandatory in the X post for judging eligibility |
| Path to the `.evidence` pack(s) | Source for the video and the proof screenshots |
| Team members, their X and LinkedIn handles, who posts | Tagging and authorship |
| Demo URL, screenshots, any recorded screen capture | Optional, improves blog and video |
| Voice notes: how the author actually talks, favourite phrases, things they would never say | Keeps the copy human |

If the brief does not say what Kane CLI caught, ask "what did a Kane run fail on, and what did you change?" That single answer makes every asset better.

## Non-negotiables

1. Tag the right accounts, with the right form per platform (see `references/handles.md`). TestMu AI on X is `@testmuai`; on LinkedIn it is the company page `TestMu AI` (linkedin.com/company/testmu-ai). Kane CLI has no separate account; write "Kane CLI" in text and tag TestMu AI. OpenAI is `@OpenAI` on X and the `OpenAI` company page on LinkedIn.
2. The X post must contain both the public Ship Page URL and the hosted deck URL. The Hack OS backend checks for exactly those two links before the team is judging-eligible. Put them in the first post of the thread, not a reply.
3. Credit both layers in one breath: "built with OpenAI, tested with Kane CLI". OpenAI's team asked for "association", not "partnership", so never write "in partnership with OpenAI" or imply OpenAI endorsed the project.
4. Every claim about what Kane CLI did must trace to a real run: a command, a step, a screenshot in the evidence pack. No invented pass counts.
5. Write like a person. Apply `references/humanize.md` to every piece before handing it over. Vary sentence length, use the author's own words from the brief, name specifics, drop filler. Never ship copy with em dashes, "here's the thing", negative parallelism, tricolons, or "delve/leverage/robust/seamless".
6. Media is not spam. One real asset per post, project first and tooling as a one-line credit, no logo walls, no reposting, no tagging people who were not involved. `references/media.md` is the rulebook; run its checklist on every image, video and PDF.
7. The user approves every public post before anything is published. Draft, show, wait. Never script the X website or LinkedIn UI; if asked to post, use an official API or hand the user the text.

## Workflow

Run in this order. Later steps reuse earlier ones.

### 1. Read and reduce the brief

Produce `launch/brief.md`: a 10-line digest with the pitch, the problem, the OpenAI usage, the three most concrete Kane CLI moments (command, what it checked, what happened), the URLs, and the author's voice notes. Every other asset is written from this digest, which keeps them consistent.

If an evidence pack is provided, run step 5a first (storyboard extraction) so you have real step names and screenshots to quote in the blog and posts.

### 2. Social posts

Read `references/social.md`. Write:

- `launch/x-thread.md`: 4 to 6 posts. Post 1 is the hook plus both mandatory links plus `@testmuai` and `@OpenAI`. Posts 2 to 4 each carry one concrete thing (the problem, the moment Kane CLI failed a run and what changed, the demo). Last post credits the team by handle and links the repo. Under 280 characters each, counted.
- `launch/linkedin.md`: 1,100 to 1,600 characters. Narrative, first person, one paragraph per idea, line breaks between paragraphs, no bullet wall. Mention `TestMu AI` and `OpenAI` as text the author will convert to tags when pasting (LinkedIn tags cannot be pre-encoded in plain text; say so in a note). Three hashtags max at the end: `#KaneCLI #BuildWithOpenAI` plus one domain tag.
- `launch/team-posts.md`: one short variant per teammate so the posts do not look copy-pasted when several people share.

### 3. Hacker News

Read `references/hackernews.md`. Write `launch/hackernews.md` with a `Show HN:` title under 80 characters that says what it does in plain words, a first comment from the author (why they built it, what is rough, what Kane CLI caught, direct questions for the thread), and a note on timing. The submitted URL is the project's showcase page on kaneclihack.sh (`/ship/<team>`); the repo URL goes in the first comment.

### 4. Launch blog

Read `references/blog.md`. Write `launch/blog.md` with these sections, each publishable on its own if the author wants to split them into a series:

1. What we built (problem, pitch, demo link, who it is for)
2. Use cases (three to five, each a short scenario)
3. How we built it (architecture in prose, the OpenAI pieces, decisions and tradeoffs)
4. Where Kane CLI changed the build (the test loop, actual commands, a failed run and the fix, screenshots from the evidence pack, the final evidence pack link)
5. What is next, how to try it, credits

Target 1,400 to 2,200 words. Include a front-matter block (title, description under 160 chars, tags, canonical URL placeholder, hero image suggestion). Add a one-paragraph TL;DR after the title. Reference the evidence pack by its `kane-cli evidence serve` command so readers can open the proof themselves.

### 5. Deck

Read `references/deck.md`. Build `launch/deck/index.html`: a self-contained HTML deck (keyboard navigation, 16:9, prints to PDF), 8 to 10 slides, following the Hack OS deck guideline: title, problem, what we built, demo (video or screenshots), how it works, the Kane CLI proof slide (one failed run, one passed run, evidence pack link), what we learned, team and links. Few boxes per slide, one idea per slide, large type. The deck is the file that gets hosted at `/ship/<team>/deck`, so it must work with no external dependencies.

### 5a. Video with voice-over

Read `references/video.md`. Pipeline:

```bash
# 1. storyboard from the evidence pack (real steps, screenshots, verdict)
python3 scripts/evidence_to_storyboard.py <pack.evidence> --brief launch/brief.md --out launch/video/

# 2. write narration into launch/video/storyboard.json (one line per scene; the script seeds drafts)
# 3. voice-over
python3 scripts/tts.py launch/video/storyboard.json --out launch/video/audio/

# 4a. render with Remotion (preferred)
bash scripts/remotion/render.sh launch/video/

# 4b. or fallback with ffmpeg only
python3 scripts/render_ffmpeg.py launch/video/storyboard.json --out launch/video/showcase.mp4
```

Three acts, in this order, and the order is the point:

1. The pitch (35 to 40s): hook, problem, who pays, what it does, demo screens, why it matters. Shark Tank shape. No tooling named yet. A viewer who stops here knows the product.
2. How we built it (8 to 10s): the OpenAI layer, model named, one decision.
3. How effectively we used Kane CLI (25 to 35s): the objective string, the failed run with annotated screenshots and the error, the fix, the passing run, the verdict from `run.yaml`.
4. Close (7s): both URLs and the credits.

60 to 90 seconds. Never trim the pitch act to fit more Kane steps. Deliver `showcase.mp4` (1920x1080) plus a 1080x1920 cut if the user wants Shorts or Reels. The brief fields `hook`, `problem`, `who`, `solution`, `demo`, `why` feed the pitch act; if they are empty, ask for them before rendering, since the pitch cannot be derived from the evidence pack.

### 6. Package and hand over

Write `launch/README.md`: the posting order and timing, who posts what, the approval checklist, and the single list of links. Then show the user the X post and LinkedIn post verbatim in the reply and ask for approval. Do not post.

## Posting order (default)

1. Ship Page and deck live, Kane verifies both URLs load (`kane-cli run "open <url> and confirm the page title is visible" --agent`).
2. Blog published (so the posts have somewhere to send people).
3. X thread from the team captain's account, within the event share window. This is the eligibility post.
4. LinkedIn post from the captain, teammates share with their own variant 2 to 6 hours later.
5. Show HN the next weekday morning, 8 to 10am US Eastern, with the author ready to answer for three hours.
6. Video uploaded natively to X and LinkedIn (not as a YouTube link) in a follow-up post 24 hours later, quoting the original.

## Files in this skill

- `references/handles.md` : exact handles, tag syntax per platform, what not to say about OpenAI
- `references/humanize.md` : the anti-AI-tell pass, with before/after examples
- `references/social.md` : X thread and LinkedIn structure, length, hooks that work for dev tools
- `references/hackernews.md` : Show HN rules and first-comment template
- `references/blog.md` : launch blog structure, SEO block, how to write the Kane CLI section from evidence
- `references/deck.md` : slide list and HTML deck conventions
- `references/media.md` : anti-spam rules for every image, video, carousel and PDF, plus distribution behaviour
- `references/video.md` : evidence pack layout, storyboard schema, Remotion and ffmpeg paths, TTS options
- `scripts/evidence_to_storyboard.py` : unzips `.evidence`, reads `run.yaml`, `result.yaml`, `steps/*/step.json`, copies screenshots, drafts narration
- `scripts/tts.py` : voice-over from storyboard (OpenAI TTS, then edge-tts, then macOS `say`)
- `scripts/render_ffmpeg.py` : dependency-light renderer
- `scripts/remotion/` : Remotion project (`render.sh`, `src/Showcase.tsx`) reading the same storyboard
- `assets/brief-template.md` : intake form
- `assets/deck-template.html` : starting point for the HTML deck
