# ADR-0018: AWS infrastructure and deployment (us-east-2, ECS Fargate, ALB, RDS, Secrets Manager, KMS) with cost controls

- **Status:** Accepted (selection and topology). The IaC tool and egress design are open (OPEN_QUESTIONS T-16, T-17). **No resources are provisioned by this ADR.**
- **Date:** 2026-11-02
- **Deciders:** Founding engineering team
- **Related:** ADR-0011, ADR-0013, ADR-0017; SYSTEM_ARCHITECTURE §14; OPEN_QUESTIONS T-1, T-6

## Context

Production must run on company-owned managed infrastructure, never on a developer's home server (ADR-0011). We need private database networking, managed secrets and encryption, and container hosting for a web service plus an independent worker, at low cost during development.

## Decision

### Provider and region
- **AWS**, primary region **`us-east-2` (US East, Ohio)**. All customer data stays in this region for MVP (NFR-10).

### Accounts and access
- AWS Organizations with **separate accounts** for `dev`, `staging`, and `prod`, plus the management (billing) account. No workloads run in the management account.
- Human access through **IAM Identity Center with MFA**. No IAM users with long-lived access keys. The root user has MFA and isn't used day to day.
- CI/CD deploys by assuming per-environment roles through **GitHub Actions OIDC** federation. No static AWS keys in GitHub.
- CloudTrail is enabled organization-wide. Security monitoring services are never disabled to save cost.

### Network
- One VPC per environment across **two Availability Zones**.
- **Public subnets:** Application Load Balancer only (plus NAT if chosen; T-17).
- **Private subnets:** ECS tasks. No public IPs.
- **Isolated private subnets:** RDS, with no route to the internet. RDS public accessibility disabled.
- Security groups: internet → ALB on 443 only; ALB → web tasks on the app port; web and worker tasks → RDS on 5432; nothing else inbound.
- Outbound from tasks: HTTPS to Supabase Auth, Google APIs (from M2), and AWS APIs. VPC endpoints are used for AWS services where they reduce NAT dependency. The exact egress design is open (T-17).

### Compute
- **ECS on Fargate** with two independent services built from one container image:
  - `web`: Next.js server, behind the ALB, at least 2 tasks across AZs in prod;
  - `worker`: background jobs, no inbound traffic, its own task role and scaling.
- Images in **ECR** with immutable tags and scan-on-push. Deploys reference image digests.
- Task roles are least-privilege and separate per service (e.g. only the worker may decrypt provider credentials from M2).
- **Database migrations** run as a one-off ECS task in the deploy pipeline using the `schoolos_owner` credentials. The app never migrates at startup.

### Load balancing and TLS
- **Application Load Balancer**, HTTPS only, ACM certificate, HTTP→HTTPS redirect, modern TLS policy.
- AWS WAF on the ALB is planned for production (M5), not required in dev.

### Database
- **RDS for PostgreSQL 18** (ADR-0013) in isolated private subnets.
- Storage encryption with a customer-managed **KMS** key; TLS required for connections (`rds.force_ssl`).
- Automated backups with point-in-time recovery; deletion protection on staging and prod.
- **Multi-AZ in prod** (by M5). Single-AZ in dev and staging.

### Secrets and keys
- **AWS Secrets Manager** for database credentials, Supabase server keys, and other runtime secrets, injected into ECS tasks as secrets (never baked into images or plain environment files). Rotation enabled where supported.
- **AWS KMS** customer-managed keys per environment for: RDS storage, Secrets Manager, application envelope encryption (Supabase session credentials in M1; Google credentials from M2), and an **asymmetric signing key** for audit checkpoints (ADR-0017).

### Observability
- CloudWatch Logs with an explicit retention period per log group (never "never expire"). PII redaction happens in the application before logging.

### Infrastructure as code
- All `dev`, `staging`, and `prod` resources are defined in IaC in this repository (tool decision T-16). No console changes in staging or prod except documented break-glass.

### Cost control (required)
- **AWS Budgets** in every account with monthly limits and alerts at 50%, 80%, and 100% (actual) and 100% (forecast), sent to the founders' email. **AWS Cost Anomaly Detection** enabled.
- **Mandatory tags** on every resource: `env`, `service`, `owner`, `cost-center`. Untagged resources are flagged in review.
- **No unnecessary always-on resources during development:**
  - dev ECS services scaled to zero when not in use;
  - dev RDS on the smallest suitable instance class, single-AZ, stopped when idle (allowing for RDS's limit on how long an instance can stay stopped);
  - the dev environment must be destroyable and recreatable from IaC;
  - staging runs only during test and release windows until M5;
  - no RDS Proxy, Multi-AZ, provisioned IOPS, extended Performance Insights retention, WAF, or per-AZ NAT gateways in dev unless an ADR justifies them.
- Cost reviewed monthly; budgets are adjusted by explicit decision, not silently.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Vercel/other PaaS for Next.js + RDS | Simple web hosting | Separate worker hosting; private DB connectivity more complex; split vendor surface |
| EKS (Kubernetes) | Flexible | Operational overhead unjustified at MVP |
| EC2 instances | Lower unit cost | Patching and host management burden |
| ECS Fargate (chosen) | No hosts to manage; private networking; separate web and worker services | Per-task cost; NAT/egress cost needs care |

## Consequences

- AWS-specific IaC and networking skills required.
- Fixed baseline costs (ALB, NAT if used, RDS) even at low traffic. Cost controls above are mandatory.

## Verification

- At M1 step 10: IaC review confirms the topology above, budgets and anomaly detection exist in every account before workloads are deployed, and no task or database has a public IP.
- Regional availability of each service in `us-east-2` is confirmed when the IaC is first applied to `dev`.
