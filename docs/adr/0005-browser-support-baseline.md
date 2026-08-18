# ADR-0005: Provisional Chrome and Safari browser baseline

- Status: accepted
- Date: 2026-08-17
- Owners: maintainers

## Context

Microphone capture, low-latency playback, workers, IndexedDB, and assistive
technology behavior vary by browser. Claiming universal support before the voice
shell exists would be misleading, but implementation needs a concrete test
baseline.

## Decision

Through M3, the required desktop browser baseline is the latest stable Chrome
and Safari on supported operating systems. Critical accessibility evidence uses
NVDA with Chrome on Windows and VoiceOver with Safari on macOS. The immediately
previous stable browser release is exercised where CI infrastructure permits.

Firefox and mobile browsers are best-effort until they pass the same critical
flow, audio, persistence, interruption, and accessibility suites. No unsupported
browser is silently blocked unless a missing capability would risk state,
privacy, or spending; otherwise the app reports the tested status and failure.

## Consequences

The project has an honest initial matrix aligned with the required manual
assistive-technology checks. Broader browser support can be added from evidence,
not user-agent assumptions. Safari-specific permission and audio behavior must
be designed from the start.

## Alternatives considered

- Claiming all evergreen browsers provides no meaningful release evidence.
- Chrome-only support would exclude the required macOS/VoiceOver path.
- Pinning exact browser versions in product policy would become stale quickly.

## Validation

M3 records exact browser, operating system, and assistive technology versions.
Before beta, maintainers publish the measured production matrix in a superseding
or amended support decision if evidence justifies a wider or narrower claim.
