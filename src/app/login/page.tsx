import { redirect } from "next/navigation";
import { hasValidSessionCookie } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: Props) {
  const isAuthed = await hasValidSessionCookie();
  if (isAuthed) {
    redirect("/");
  }

  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_20%_15%,_#eab308_0%,_#92400e_18%,_#111827_50%,_#020617_100%)] p-8">
      <Card className="w-full max-w-md border-slate-700/80 bg-slate-950/75 text-slate-100 backdrop-blur-sm">
        <CardHeader>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-300">Secure Access</p>
          <CardTitle className="mt-2 text-2xl">Jira Worklog Dashboard</CardTitle>
          <CardDescription className="text-slate-300">
            Enter the app password configured in `.env.local`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4" method="post" action="/api/auth/login">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            {error === "invalid_credentials" && (
              <p className="rounded bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
                Invalid password. Please try again.
              </p>
            )}
            {error === "server_misconfigured" && (
              <p className="rounded bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
                Server missing required auth environment variables.
              </p>
            )}
            <Button type="submit" className="w-full bg-amber-300 text-black hover:bg-amber-200">
              Unlock Dashboard
            </Button>
          </form>
          <p className="text-xs text-slate-400">Desktop-only POC optimized for internal usage.</p>
        </CardContent>
      </Card>
    </main>
  );
}
