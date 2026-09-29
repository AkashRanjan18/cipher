import type { Metadata } from "next";
import { ProfileView } from "@/components/social/profile-view";

/** A trader's public page: cipher.family/u/<handle>. The view does the work. */

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${handle.toLowerCase()} on cipher` };
}

export default async function Profile({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <ProfileView handle={handle.toLowerCase()} />;
}
