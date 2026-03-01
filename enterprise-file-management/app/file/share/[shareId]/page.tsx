import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { jwtVerify } from "jose";
import prisma from "@/lib/prisma";
import ShareAuthClient from "./ShareAuthClient";
import ShareViewerClient from "./ShareViewerClient";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback_secret_for_development"
);

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: { params: { shareId: string } }) {
  const { shareId } = params;

  // Verify Share exists
  const share = await prisma.share.findUnique({
    where: { id: shareId },
    include: { file: true }
  });

  if (!share) return notFound();

  // If status is not active, maybe show a generic error page instead of notFound
  if (share.status !== "ACTIVE" || new Date() > new Date(share.expiry) || share.downloads >= share.downloadLimit) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <div className="text-destructive mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </div>
        <h1 className="text-3xl font-bold mb-2">Link Expired or Revoked</h1>
        <p className="text-gray-500 max-w-md mx-auto">
          The secure access link for this file is no longer active, has expired, or the maximum number of downloads has been reached. Please contact the sender for a new link.
        </p>
      </div>
    );
  }

  // Check if session cookie exists
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(`share_session_${shareId}`);
  let isAuthenticated = false;

  if (sessionCookie) {
    try {
      const { payload } = await jwtVerify(sessionCookie.value, JWT_SECRET);
      if (payload.shareId === shareId && payload.access) {
        isAuthenticated = true;
      }
    } catch (e) {
      // Cookie invalid or expired
    }
  }

  // If authenticated, show the viewer (download button + file info)
  if (isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] p-4 bg-gray-50">
        <ShareViewerClient shareId={shareId} file={share.file} share={share} />
      </div>
    );
  }

  // Otherwise, show the Auth form (request email/password -> send magic link)
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] p-4 bg-gray-50">
      <ShareAuthClient shareId={shareId} requiresPassword={share.passwordProtected} />
    </div>
  );
}
