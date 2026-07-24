import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ROLE_COOKIE, TOKEN_COOKIE } from "@/lib/backend";

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!token) redirect("/login");
  const role = cookieStore.get(ROLE_COOKIE)?.value;
  redirect(role === "platform_admin" ? "/admin" : "/dashboard");
}
