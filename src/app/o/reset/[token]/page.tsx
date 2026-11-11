import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "../../login/AuthForms";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default function OnlineReset({ params }: PageProps<"/online/reset/[token]">) {
  return (
    <section className="container-page max-w-md py-20">
      <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">Online hackathon</p>
      <h1 className="mb-8 mt-2 font-display text-4xl text-bright">Choose a new password</h1>
      <Suspense>
        <WithToken params={params} />
      </Suspense>
    </section>
  );
}

async function WithToken({ params }: Pick<PageProps<"/online/reset/[token]">, "params">) {
  return <ResetForm token={(await params).token} />;
}
