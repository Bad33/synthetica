import { PaperReader } from "@/components/paper-reader";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PaperReader id={id} />;
}
