import type { ReactNode } from "react";
import { connection } from "next/server";
import { Suspense } from "react";
import { submissionsClosed } from "@/data/online";

/** Shows `children` until the submission deadline and `after` once it has passed. It reads the
 *  clock on each request, so the page switches at 11:59 PM IST without a redeploy. */
export default function UntilClose({ children, after = null }: { children: ReactNode; after?: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Gate after={after}>{children}</Gate>
    </Suspense>
  );
}

async function Gate({ children, after }: { children: ReactNode; after: ReactNode }) {
  await connection();
  return submissionsClosed() ? after : children;
}
