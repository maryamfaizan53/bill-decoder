import { notFound } from "next/navigation";
import { BillView } from "@/components/BillView";

export const dynamic = "force-dynamic";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(id)) notFound();
  return <BillView id={id} />;
}
