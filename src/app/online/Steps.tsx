// The registration path, shown on top of each step.
const STEPS = ["You", "Your team", "Get set up", "Submit"];

export default function Steps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <nav aria-label="Registration progress" className="mb-8">
      <p className="sr-only">
        Step {current} of {STEPS.length}: {STEPS[current - 1]}
      </p>
      <ol className="flex flex-wrap gap-x-5 gap-y-2 font-pixel text-xs uppercase tracking-[0.15em]">
        {STEPS.map((s, i) => {
          const n = i + 1;
          return (
            <li key={s} aria-current={n === current ? "step" : undefined} className={n === current ? "border-b-2 border-lime pb-1 text-lime" : n < current ? "pb-1 text-bright" : "pb-1 text-lightgray"}>
              {String(n).padStart(2, "0")} {s}
              {n < current && <span className="sr-only"> (done)</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
