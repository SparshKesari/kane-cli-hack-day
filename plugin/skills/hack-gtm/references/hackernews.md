# Show HN

Hacker News rewards plain description and punishes marketing language harder than any other channel. The post is a title plus a URL plus a first comment from the author. There is no body text on a link post.

The author posts it from their own account, in their own words. The site tells people exactly that, because HN flags generated text. So this skill hands over the title, the URL and an outline with the facts, and the author writes the comment.

## Rules (from the HN Show HN guidelines)

- Title starts with `Show HN:` and describes what the thing does. No superlatives, no "revolutionary", no exclamation marks, no emoji.
- The thing must be something people can try: a live demo, a repo they can run, or a video if neither exists. A landing page with a waitlist is not a Show HN.
- One submission. Do not resubmit under a different title the same week. Do not ask friends to upvote; HN detects voting rings and buries the post.
- The author must be present to answer for the first few hours.
- Submit the repo URL or the live demo URL: the site's rubric asks for the HN post to link one of those. Use the live demo if a stranger can try it without signing up, otherwise the repo. The Ship Page (`https://kaneclihack.sh/ship/<team>`), which carries the demo video, the verified repo and submitted SHA, the team's Kane CLI runs and the deck in one place, goes in the first comment once a teammate has published it.

## Title

Under 80 characters. Pattern: `Show HN: <Name> – <what it does> (<built at a 7-hour hackathon>)`. HN converts a plain hyphen with spaces to an en dash; type a hyphen.

Good:
- `Show HN: Orbit - a release checklist that runs itself in a real browser before deploy`
- `Show HN: I built a Slack bot that files bugs with a Kane CLI evidence pack attached`

Bad:
- `Show HN: Orbit, the AI-powered future of release management`
- `Show HN: We built something cool at a hackathon`

## First comment: an outline the author rewrites

The author posts it within a minute of submitting, typed in their own words. Don't write it for them. Hand over an outline with the real facts filled in (names, model, numbers, the Kane failure) as short notes, not sentences to paste. When they write it: 150 to 300 words, plain text, short paragraphs. The outline covers:

1. Why they built it, in one personal sentence.
2. How it works, two or three sentences; name the OpenAI model/API and Kane CLI plainly.
3. What is rough or missing. HN trusts people who list their own bugs.
4. The one thing Kane CLI caught, concretely. HN readers like test stories with specifics.
5. What they want from the thread: feedback on X, whether anyone has solved Y.

Remind them: no hashtags, handles, or "please upvote", and don't paste the LinkedIn post.

Outline shape:

```
Facts for your first comment. Write it yourself, in your own words; HN flags pasted, generated text.

- Who: <name>, one of <n> who built it at Kane CLI Hack Day in SF, <date>
- What it does: <one line>
- Why you built it: <their reason, from the brief>
- Links: Ship Page <url> (runs and deck); repo <url> at <short SHA>, if the repo isn't the submitted URL
- Under the hood: <OpenAI model/API> does <role>
- What Kane CLI caught: <objective string>; failed <n> times on <step>; cause <...>; fix <...>
- Rough edges: <two or three honest items>
- Question for the thread: <specific question>
```

If the submitted URL (demo or repo) is slow or down at posting time, do not submit; HN readers bounce in seconds and the thread dies. If they want, check it first with a Kane run that the Kane CLI skill writes (open the URL, confirm the project name and what it does are visible).

## Timing

Today: submit before 18:00 Pacific so it counts, then a signed-in teammate pastes the HN link into the HN post row on the Submit tab, ticks it and presses Save. Have two teammates ready to answer for the next few hours. Reply to critical comments first and without defensiveness.

After the event only: a weekday morning, 8 to 10am US Eastern, gets more readers, but that doesn't count for the prize, and one submission is the rule.

## If it does not take off

Most Show HNs get under ten upvotes. That is normal. Do not delete and repost. If HN flags the post, keep its link on the Submit tab: the site's rubric still scores a flagged post when the link is shared. Link the HN thread from the blog so the discussion stays discoverable.
