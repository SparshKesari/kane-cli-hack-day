import StartCommand from "@/components/home/StartCommand";
import Decode from "@/components/ui/Decode";
import Statue from "@/components/art/Statue";
import Caption from "@/components/art/Caption";

// Giant sign-off, like gradium.ai's "Start building": the line and the way in,
// beside the Winged Victory on her ship's prow.
export default function Closer() {
  return (
    <section className="relative isolate overflow-hidden border-t border-dashed border-hairline py-24 sm:py-32">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(#3a3a3a_1px,transparent_1.5px)] [background-size:10px_10px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />
      <div className="container-page grid items-center gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <h2 className="font-dots text-[15vw] leading-[0.85] font-black tracking-[-0.04em] whitespace-nowrap text-bright sm:text-[8rem] lg:text-[6.5rem] xl:text-[8rem]">
            <Decode text="Ship by 6" />
          </h2>
          <StartCommand className="mt-10" />
        </div>
        {/* Nike, goddess of victory, landing on a warship's prow: ship it, and win. */}
        <figure className="mx-auto w-64">
          <Statue name="victory" alt="The Winged Victory of Samothrace on a ship's prow, printed as a halftone" className="mx-auto w-56 lg:w-64" />
          <Caption n={5}>Nike lands on the prow of a ship. Victory goes to those who ship.</Caption>
        </figure>
      </div>
    </section>
  );
}
