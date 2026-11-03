import type { JSX } from "react";
import type { Metadata } from "next";
import { getServerEnv } from "@/platform/config/env";
import { healthPayload } from "@/platform/http/health";

export const metadata: Metadata = {
  title: "Status",
};

export const dynamic = "force-dynamic";

export default function StatusPage(): JSX.Element {
  const env = getServerEnv();
  const health = healthPayload();

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Service status</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Live process information for this installation. No organization, device, or student data
          is stored or displayed.
        </p>
      </div>
      <dl className="border-border grid gap-4 border-t pt-6 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Web service</dt>
          <dd className="mt-1 font-mono">{health.service}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Health</dt>
          <dd className="mt-1 font-mono">{health.status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Application environment</dt>
          <dd className="mt-1 font-mono">{env.appEnv}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Auth adapter</dt>
          <dd className="mt-1 font-mono">{env.authProvider} (not connected)</dd>
        </div>
      </dl>
    </div>
  );
}
