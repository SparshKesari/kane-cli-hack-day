# Activation

Three steps, after the team is locked. `participant_get_status` returns activation_steps: `testmu_signup` and `codex_credits` (true or false), `testmu_plan` (`not_started`, `pending`, `claimed`, `not_registered` or `error`) and `done`.

1. **TestMu AI sign-up** (`testmu_signup`): step 2's claim creates the TestMu AI account and ticks it. Only if the claim can't run and they tell you they signed up themselves: ask "Mark the TestMu AI sign-up done?", then `activation_tick` with `step: "testmu_signup"` and `explicit_confirmation: true`.
2. **TestMu AI plan** (`testmu_plan`): `kanehack claim --json`. It uses the password saved with `kanehack password` (their kaneclihack.sh password is also their TestMu AI password).
   - 0 → claimed.
   - 2 → show its message. Not registered: they sign up on TestMu AI with the same email ("Type **done** here when it's finished."), then `kanehack claim --json` again. Wrong password (the email already has a TestMu AI account with a different password): ask if they know that account's password. Yes → `kanehack password --testmu` in their own terminal ("Type **done** here when it's finished."), then `kanehack claim --json`. No, they signed up there with Google or GitHub (no password yet), or it's refused again → they set a new one at https://accounts.lambdatest.com/password/reset with the same email ("Type **done** here when it's finished."), save it with `kanehack password --testmu` in their own terminal ("Type **done** here when it's finished."), then `kanehack claim --json`. TestMu AI allows 5 tries a minute: wait a minute before trying again. Only a fresh reset that's still refused goes to the help desk.
   - 4 → still activating: wait a few seconds and run it again.
3. **Codex credits** (`codex_credits`): the OpenAI Codex coupon comes by email, to people on the participant list. Ask "Send your Codex coupon to <their signed-in email>?", then `codex_coupon_send` with `explicit_confirmation: true`. `data.outcome`:
   - `sent` → it's in their inbox (spam too). Asking again re-sends the same coupon. They redeem it themselves: "Redeem the Codex coupon from your email. Type **done** here when it's finished, and I'll tick step 3." Their done is the yes for that tick: `activation_tick` with `step: "codex_credits"` and `explicit_confirmation: true`.
   - `not_on_list` → ask which email they registered for the event with. If it's another address, confirm it, then `codex_coupon_send` with that `email` and `explicit_confirmation: true`. Still not on the list → the help desk.
   - `out_of_codes` → the help desk.

Activation is done when `participant_get_status` shows activation_steps.done true; never report it from their word alone. The same steps show on `https://kaneclihack.sh/activate`.

Never ask for, repeat or store the coupon. If the email hasn't arrived, they check spam, then ask at the help desk.

Then → `references/idea.md`.
