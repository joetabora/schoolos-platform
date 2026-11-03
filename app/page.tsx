import type { JSX } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getPublicEnv } from "@/platform/config/public-env";

export default function HomePage(): JSX.Element {
  const { appName } = getPublicEnv();

  return (
    <div className="flex flex-col gap-12">
      <section className="flex max-w-3xl flex-col gap-5">
        <p className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
          Application foundation
        </p>
        <h1 className="text-3xl font-medium tracking-tight text-balance sm:text-4xl">
          {`${appName} is a K-12 device security and management platform.`}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-base leading-7">
          This installation is the staff application shell. It does not yet authenticate users,
          isolate organizations, inventory devices, or enforce policy. Those capabilities are
          scheduled in later milestones and will not be shown here until they exist.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/status">View service status</Link>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/v1/health">Health endpoint</a>
          </Button>
        </div>
      </section>

      <section className="border-border grid gap-6 border-t pt-10 sm:grid-cols-3">
        <article>
          <h2 className="text-sm font-medium">Independent product</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {appName} is not a plugin or reseller add-on. Google APIs will be one integration, not
            the product itself.
          </p>
        </article>
        <article>
          <h2 className="text-sm font-medium">Tenant isolation first</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Multi-organization isolation, server-side authorization, and audit logging are
            requirements of the architecture. They are not implemented in this step.
          </p>
        </article>
        <article>
          <h2 className="text-sm font-medium">Truthful status</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            This page does not display sample devices, alerts, or districts. Simulated data will
            only appear later, and only when an organization is explicitly marked as a demo tenant.
          </p>
        </article>
      </section>
    </div>
  );
}
