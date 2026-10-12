/* Retired marketing routes: the public site is one page now. A 308 keeps
   old links and search results pointing at the matching section. The
   relative Location keeps the redirect on whatever host serves the app. */
export function permanentTo(location: string): Response {
  return new Response(null, { status: 308, headers: { Location: location } });
}
