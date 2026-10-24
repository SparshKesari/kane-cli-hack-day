# Humanize pass

Run this on every public-facing piece before handover. The goal is copy a reader would attribute to the builder, not to a model. Do the pass twice: once while drafting, once as a final read-through of the whole kit, because patterns that are fine once become a tell when they repeat across the X thread, the LinkedIn post and the blog.

## Source the voice from the brief

- Reuse the author's own phrases from the brief and voice notes. If they wrote "it kept eating my cookies", keep it.
- Keep their spelling (US or UK) consistent across all pieces.
- If they gave examples of what they would never say, grep the drafts for them.

## Delete on sight

- Em dashes. Use a comma, a full stop, or a colon.
- Negative parallelism: "it's not X, it's Y", "this isn't about X, it's about Y".
- Fragment stacks: "Not X. Not Y. Just Z."
- Self-answered rhetorical questions: "The result? Faster builds."
- "Here's the thing", "here's the kicker", "here's where it gets interesting", "plot twist".
- "Let's dive in", "let's unpack", "let's break this down", "buckle up".
- "Think of it as", "imagine a world where", "picture this".
- "In conclusion", "to sum up", "at the end of the day".
- Magic adverbs: quietly, deeply, fundamentally, remarkably, seamlessly, effortlessly.
- Overused vocabulary: delve, leverage, robust, streamline, seamless, tapestry, landscape, ecosystem, game-changer, supercharge, unlock, empower, elevate, harness, journey (as a noun for a project), "excited to announce".
- "serves as", "stands as", "represents" when "is" works.
- Tricolons and anaphora used more than once per piece.
- Vague attribution: "experts say", "studies show", "many developers".
- Invented concept labels in Title Case that the author never used.
- Unicode arrows, smart quotes, emoji bullets. One emoji in a LinkedIn post is fine if the author uses them.
- Bold-first bullets ("**Speed:** we made it fast").
- Opening with "In today's fast-paced world" or any sentence about how AI is changing everything.
- Closing with a question to drive engagement unless the question is one the author actually wants answered.

## Add

- One specific number from the real run (steps, seconds, number of fails before the pass).
- One sentence that only this author could have written: a mistake, a surprise, something that annoyed them.
- Varied sentence length. Read it out loud. If three sentences in a row have the same shape, change one.
- Plain verbs. "Kane CLI clicked the checkout button and the total was wrong" beats "Kane CLI validated the checkout flow".
- Where the AI helped and where it did not. Admitting Codex wrote something you had to rewrite reads as honest.

## Before and after

Before:
> We're thrilled to announce Orbit, a game-changing release harness that leverages OpenAI's cutting-edge models and is rigorously verified by Kane CLI. It's not just a tool; it's a new way of shipping.

After:
> Orbit is a release harness we built in six hours this Saturday. GPT-5 drafts the release notes from the diff, and Kane CLI runs the staging checklist in a real Chrome before anything goes out. The first four Kane runs failed. Post 3 explains why.

Before:
> Here's the thing: testing is hard. Kane CLI makes it seamless.

After:
> Our login test failed three times because the OTP field only appeared after a 900ms animation. Kane CLI waited, we didn't. We added the wait and the pass stuck.

## Final check (yes to all before handover)

- Could the author have typed this on their phone?
- Does every claim about Kane CLI point to a real step or run?
- Are both mandatory URLs in X post 1?
- Does the LinkedIn post name TestMu AI and OpenAI exactly once each in text?
- Did any of the banned phrases survive? Search for: "—", "not just", "here's", "dive", "delve", "leverage", "seamless", "robust", "journey", "excited to", "game".
