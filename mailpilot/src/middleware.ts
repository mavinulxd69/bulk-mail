import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
type CookieToSet = { name: string; value: string; options: CookieOptions };
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const p = req.nextUrl.pathname;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    if (p.startsWith("/dashboard") || p.startsWith("/admin")) {
      const login = new URL("/login", req.url);
      login.searchParams.set("error", "Supabase is not configured. See README setup.");
      return NextResponse.redirect(login);
    }
    return res; // public and auth pages show setup states where applicable
  }
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: CookieToSet[]) => { list.forEach(({ name, value }) => req.cookies.set(name, value)); res = NextResponse.next({ request: req }); list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && (p.startsWith("/dashboard") || p.startsWith("/admin"))) return NextResponse.redirect(new URL("/login", req.url));
  if (user && ["/login", "/signup", "/forgot-password"].includes(p)) return NextResponse.redirect(new URL("/dashboard", req.url));
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
