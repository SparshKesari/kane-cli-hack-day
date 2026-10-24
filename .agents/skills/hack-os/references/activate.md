# Activation

Three steps, after the team is locked. `participant_get_status` returns activation_steps: `testmu_signup` and `codex_credits` (true or false), `testmu_plan` (`not_started`, `pending`, `claimed`, `not_registered` or `error`) and `done`.

1. **TestMu AI sign-up** (`testmu_signup`): step 2's claim creates the TestMu AI account and ticks it. Only if the claim can't run and they tell you they signed up themselves: ask "Mark the TestMu AI sign-up done?", then `activation_tick` with `step: "testmu_signup"` and `explicit_confirmation: true`.
2. **TestMu AI plan** (`testmu_plan`): `kanehack claim --json`. It uses the password saved with `kanehack password` (their kaneclihack.sh password is also their TestMu AI password).
   - 0 → claimed.
   - 2 → show its message. Not registered: they sign up on TestMu AI with the same email ("Type **done** here when it's finished."), then `kanehack claim --json` again. They already had a TestMu AI account with a different password: they run `kanehack password --testmu` in their own terminal ("Type **done** here when it's finished."), then `kanehack claim --json`.
   - 4 → still activating: wait a few seconds and run it again.
3. **Codex credits** (`codex_credits`): the OpenAI Codex coupon arrives by email, at the address they registered with. They redeem it themselves: "Redeem the Codex coupon from your email. Type **done** here when it's finished, and I'll tick step 3." Their done is the yes for that tick: `activation_tick` with `step: "codex_credits"` and `explicit_confirmation: true`.

Activation is done when `participant_get_status` shows activation_steps.done true; never report it from their word alone. The same steps show on `https://kaneclihack.sh/activate`.

Never ask for, repeat or store the coupon. If the email hasn't arrived, they check spam, then ask at the help desk.

Then → `references/idea.md`.
