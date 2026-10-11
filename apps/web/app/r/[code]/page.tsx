import { redirect } from "next/navigation";

/** a shared room link (plan §10: /r/{code}) opens the online duel and joins that room */
export default async function RoomLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/online?join=${encodeURIComponent(code.toUpperCase())}`);
}
