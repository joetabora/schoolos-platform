import type { JSX, ReactNode } from "react";
import Link from "next/link";
import { getPublicEnv } from "@/platform/config/public-env";

type AppShellProps = {
  readonly children: ReactNode;
};

export function AppShell({ children }: AppShellProps): JSX.Element {
  const { appName } = getPublicEnv();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border bg-background border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/" className="flex min-w-0 items-baseline gap-3 no-underline">
            <span className="text-foreground font-mono text-sm font-semibold tracking-[0.18em] uppercase">
              {appName}
            </span>
            <span className="text-muted-foreground hidden text-sm sm:inline">
              Device security platform
            </span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
            <Link
              href="/"
              className="text-foreground hover:bg-muted rounded-md px-3 py-1.5 no-underline"
            >
              Overview
            </Link>
            <Link
              href="/status"
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-3 py-1.5 no-underline"
            >
              Status
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:py-14">{children}</main>
      <footer className="border-border border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>{appName} is an independent commercial product for school-owned devices.</p>
          <p>Google is an integration provider, not the owner of this platform.</p>
        </div>
      </footer>
    </div>
  );
}
