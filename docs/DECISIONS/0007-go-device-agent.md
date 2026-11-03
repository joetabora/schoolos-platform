# ADR-0007: Go for the future native device agent

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** SYSTEM_ARCHITECTURE §13, ROADMAP M7–M9

## Context

A native agent will run on our Linux-based educational OS and possibly other platforms. It must be small, reliable, easy to distribute, and strong at networking and cryptography.

## Decision

Write the device agent in Go. Core logic is OS-neutral; OS-specific code lives behind interfaces in `platform/<os>` packages.

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| Rust | Memory safety without GC, small binaries | Steeper learning curve, slower team velocity |
| TypeScript/Node | Shared language with web | Runtime dependency, larger footprint, weaker fit for system service |
| C/C++ | Maximum control | Memory-safety risk |
| Go (chosen) | Static binaries, cross-compilation, mature TLS/crypto stdlib, good concurrency | GC (acceptable for agent workloads); larger binaries than Rust |

## Consequences

- Two languages in the company (TypeScript, Go). Shared contracts (command envelope, event schemas) defined in a language-neutral schema (e.g. JSON Schema or Protobuf; decided in M7).

## Verification

Revisit at M7 start if hard real-time, kernel-level, or footprint constraints emerge.
