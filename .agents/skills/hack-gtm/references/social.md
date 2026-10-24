# Social posts: X and LinkedIn

## X thread

Length: 4 to 6 posts. Each under 280 characters including URLs (a URL counts as 23 characters regardless of length). Count before handing over; put the count in a comment after each post.

### Post 1 (the launch post)

Must contain: hook sentence, the Ship Page URL (and the deck URL if they published one), `@testmuai`, `@OpenAI`. Nothing else. Do not start with a mention. Post it only after a teammate has published the Ship Page and it loads in a private window; before that the link is a 404.

Shape that works for dev tools:

```
We built <Project> at Kane CLI Hack Day: <what it does in 8 words>.

Built with @OpenAI, tested with Kane CLI from @testmuai. Live proof and deck:
<ship page url>
<deck url>
```

Attach: the 1920x1080 showcase video if it is already rendered and approved, else the hero screenshot. Don't hold the thread for the video; it can follow later as a quote of post 1. Native video gets more reach than a link.

### Post 2: the problem

One concrete scenario the author has lived. Who hits it, what breaks, how often. No stats you cannot source.

### Post 3: the Kane CLI moment

The most valuable post in the thread. Structure: what the test asserted, what failed, what the screenshot showed, what you changed, that it passed. Quote the actual objective string from the `kane-cli run` command in backticks if it fits. Attach the annotated screenshot of the failed step (`steps/<n>-<id>/annotated.png` in the pack), only after the person has looked at it and said yes.

### Post 4: the build

What OpenAI piece did what. Model name, API surface, one tradeoff. Attach a screenshot of the app or the architecture slide from the deck.

### Post 5 (optional): the demo

A 15 to 30 second clip of the app in use, or three screenshots.

### Last post: credits

Teammate handles, repo link, the hashtag from the brief. If the hack day has a hashtag, it goes here, not in post 1.

### Things that lower reach on X

- Starting with `@` (becomes a reply-style post)
- More than two hashtags
- Links in every post (keep them to post 1 and the last post)
- Posting all six within a minute; space 20 to 40 seconds apart, or schedule as a thread in one go
- Quoting your own earlier post inside the thread

## LinkedIn post

Length: 1,100 to 1,600 characters. The first 210 characters show before "see more", so the hook must stand alone.

Structure:

1. Hook (one or two lines): what you built and the one surprising fact. No "excited to share".
2. Context (two to three lines): the hack day, the time limit, who you built with.
3. The build (three to four lines): the OpenAI piece in plain words.
4. The test loop (four to five lines): what Kane CLI ran, the fail, the fix, the pass. Point to the public proof: the Ship Page lists the Kane runs (plus the run report, if they published one). Don't mention the evidence pack as something readers can open; it stays private.
5. What you learned (two lines): one honest take.
6. Links (Ship Page, deck, repo) on their own lines.
7. Credits: teammates by name, TestMu AI and OpenAI named once each in text for tagging.
8. Up to three hashtags.

Formatting: blank line between paragraphs, no bullet lists, no bold, one emoji maximum. Put the links in the post body, not the first comment; LinkedIn no longer penalises in-post links the way it did, and a link in the comment gets lost.

Attach the showcase video natively if it is ready (under 10 minutes, under 5 GB, MP4), or a carousel PDF export of the deck; don't hold the post for the video. A document post (PDF) of the deck performs well on LinkedIn for hackathon projects because people swipe through.

Tagging note to add to the handover: "LinkedIn tags are not carried in plain text. When you paste, type @ before TestMu AI, OpenAI and each teammate and select the page or profile from the dropdown."

## Teammate variants

Write one 500 to 800 character variant per teammate, each from a different angle (what they personally built, what surprised them, what they would do differently). Same links. These must not read as copies of the captain's post.

## Timing

- Today (Saturday): X and LinkedIn both go out before submissions lock at 18:00 Pacific, so they count. The X link goes in the X post row on the Submit tab, ticked and saved; LinkedIn has no row, so its link goes in "Social posts" on the Submit form. Teammates post their variants a while after the captain, not at the same minute, and before 18:00 if they should count.
- After the event only (it doesn't count for the prize): LinkedIn reaches most people Tuesday to Thursday, 8 to 10am in the author's time zone, if they want to post again then.
- Reply to every comment in the first two hours. Early replies lift distribution on both platforms.
