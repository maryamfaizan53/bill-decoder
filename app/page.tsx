import Link from "next/link";
import { Dropzone } from "@/components/Dropzone";
import { isModelConfigured } from "@/lib/pipeline/config";
import { listSamples } from "@/lib/server/bills";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Sharpen the photo", body: "The bill is straightened, contrast is lifted, and two zoomed halves are cut out so small print stays readable." },
  { title: "Read it three times", body: "The model reads the bill three separate times. Each field takes the value most readings agree on." },
  { title: "Check the arithmetic", body: "Charge lines must add up to the charges subtotal, taxes to the tax subtotal, and both to the current bill." },
  { title: "Look again where it doesn't add up", body: "If a total disagrees, the model re-reads only those lines. Values are never changed just to make a sum work." },
  { title: "Answer with code, not guesses", body: "Averages, percentages and estimates are calculated in code. The model explains them in plain English." },
];

export default async function Home() {
  const samples = await listSamples();
  const live = isModelConfigured();

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="grid gap-10 pb-16 pt-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14 lg:pt-12">
        <div>
          <h1 className="display text-[2.6rem] sm:text-6xl">Your electricity bill, read line by line.</h1>
          <p className="urdu mt-3 text-2xl text-muted" lang="ur">
            آپ کا بجلی کا بل، سطر بہ سطر
          </p>
          <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-muted">
            Upload a K-Electric, LESCO or IESCO bill. You get the amount due, the dates that matter, where every rupee goes,
            and answers to your questions, all checked against the bill itself.
          </p>
        </div>
        <Dropzone />
      </section>

      <section aria-labelledby="samples-title" className="pb-16">
        <div className="section-title">
          <h2 id="samples-title" className="heading text-xl">
            Or open a sample bill
          </h2>
          <span className="urdu text-muted" lang="ur">نمونہ بل</span>
        </div>
        {!live && (
          <p className="mb-4 max-w-[60ch] text-muted">
            No API key is set, so samples open with their saved, hand-checked results. Add <code>API_KEY</code> to <code>.env</code> to decode new bills live.
          </p>
        )}
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {samples.map((s) => (
            <li key={s.id}>
              <Link href={`/bill/${s.id}`} className="group block">
                <div className="aspect-[3/4] overflow-hidden rounded-md border border-rule bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/bills/${s.id}/image`}
                    alt={`Sample bill: ${s.title}`}
                    className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
                    loading="lazy"
                  />
                </div>
                <p className="mt-2 font-semibold leading-snug group-hover:text-grid">{s.title}</p>
                <p className="num text-sm text-muted">{s.id}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="how" aria-labelledby="how-title" className="scroll-mt-6">
        <div className="section-title">
          <h2 id="how-title" className="heading text-xl">
            How a bill is read
          </h2>
          <span className="urdu text-muted" lang="ur">بل کیسے پڑھا جاتا ہے</span>
        </div>
        <ol className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-t-2 border-grid pt-3">
              <span className="num text-sm font-semibold text-grid">Step {i + 1}</span>
              <h3 className="heading mt-1 text-lg leading-snug">{s.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 max-w-[62ch] text-muted">
          On the five training bills this pipeline matched all 90 hand-checked fields. Names, addresses and account numbers are never read or stored.
        </p>
      </section>
    </main>
  );
}
