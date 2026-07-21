# OTP Display Grant — Implementation Plan

Companion to [otp-display-grant-plan.md](./otp-display-grant-plan.md). This document breaks the feature into small, reviewable phases. Each phase should land as an independent PR where possible.

## Progress Summary

| Phase | Status | Notes |
| --- | --- | --- |
| 0 | Skipped (informal) | Unit tests verified green during Phases 1–3 |
| 1 | **Done** | Core protocol types |
| 2 | **Done** | Dapp `requireOtpDisplayGrant` + session request capability |
| 3 | **Done** | Wallet deferred `display_otp` + grant routing |
| 4 | **Done** | Dapp grant send & strict validation |
| 5 | **Done** | Dedicated error codes (`OTP_DISPLAY_GRANT_REQUIRED`, `OTP_DISPLAY_GRANT_TIMEOUT`) |
| 6 | **Partial** | Dapp + wallet strict unit tests done; wallet full strict happy path with grant event pending |
| 7 | **Not started** | E2E + compatibility matrix |
| 8 | **Not started** | Demos & docs |
| 9 | **Not started** | Final verification |

**Current blocker:** None for unit-level strict flow. **Next:** Phase 8 demos & documentation.

## Scope

Add an opt-in strict untrusted flow:

```ts
await dappClient.connect({
  mode: "untrusted",
  requireOtpDisplayGrant: true,
});
```

Default behavior (`connect({ mode: "untrusted" })`) must remain unchanged.

## Packages Touched

| Package | Role |
| --- | --- |
| `packages/core` | Protocol types, error codes, exports |
| `packages/dapp-client` | `requireOtpDisplayGrant`, grant send, strict validation |
| `packages/wallet-client` | Deferred `display_otp`, grant receive |
| `apps/integration-tests` | E2E + compatibility matrix |
| `apps/web-demo` | Optional strict-mode toggle |
| `docs/` | Connection flow doc update |

## Phase Overview

| Phase | Goal | Depends on | Status |
| --- | --- | --- | --- |
| 0 | Baseline & guardrails | — | Skipped |
| 1 | Core protocol types | 0 | Done |
| 2 | Dapp connect options & session request | 1 | Done |
| 3 | Wallet deferred OTP display | 1 | Done |
| 4 | Dapp grant send & strict validation | 2, 3 | Done |
| 5 | Error codes & timeouts | 4 | Done |
| 6 | Unit tests | 2–5 | Partial |
| 7 | Integration tests | 6 | **Next** |
| 8 | Demos & docs | 7 | Not started |

---

## Phase 0 — Baseline & Guardrails

Confirm current behavior before changing it.

- [ ] **0.1** Run existing untrusted unit tests in both clients and note green baseline.
  - `packages/dapp-client/src/handlers/untrusted-connection-handler.test.ts`
  - `packages/wallet-client/src/handlers/untrusted-connection-handler.test.ts`
- [ ] **0.2** Run integration tests (`apps/integration-tests`) to confirm E2E untrusted flow still passes.
- [ ] **0.3** Document the current step order in both handlers (for diff review):
  - Wallet: generate OTP → `display_otp` → `handshake-offer` → wait ack
  - Dapp: wait offer → OTP input → create session → subscribe secure channel → `handshake-ack`

**Exit criteria:** All existing untrusted tests pass; team agrees on backward-compat requirement (no silent fallback).

---

## Phase 1 — Core Protocol Types

Add types only. No behavior change yet.

**File:** `packages/core/src/domain/session-request.ts`

- [x] **1.1** Extend `SessionRequest`:

```ts
capabilities?: {
  otpDisplayGrant?: true;
};
```

**File:** `packages/core/src/domain/protocol-message.ts`

- [x] **1.2** Add `otpDisplayGrantRequired?: true` to `HandshakeOfferPayload`.
- [x] **1.3** Add new message type:

```ts
export type OtpDisplayGrant = {
  type: "otp-display-grant";
};
```

- [x] **1.4** Extend `ProtocolMessage` union to include `OtpDisplayGrant`.

**File:** `packages/core/src/index.ts`

- [x] **1.5** Re-export `OtpDisplayGrant` (and any new error codes from Phase 5 if added in same PR).

**Exit criteria:** Packages compile; no runtime behavior change; existing tests still pass.

---

## Phase 2 — Dapp Connect Options & Session Request

Wire the dapp opt-in flag into the QR payload. Still uses the legacy flow internally.

**File:** `packages/dapp-client/src/client.ts`

- [x] **2.1** Add `requireOtpDisplayGrant?: boolean` to `DappConnectOptions`.
- [x] **2.2** In `_createPendingSessionAndRequest()`, when `requireOtpDisplayGrant === true`, set:

```ts
capabilities: { otpDisplayGrant: true }
```

on the emitted `SessionRequest`.
- [x] **2.3** Pass strict-mode intent via `SessionRequest.capabilities` (handler reads `request`, not a duplicate context flag).

**Tests (minimal for this phase)**

- [x] **2.5** Unit test: `connect({ requireOtpDisplayGrant: true })` emits `session_request` with `capabilities.otpDisplayGrant === true`. Covered in `client.integration.test.ts`.
- [x] **2.6** Unit test: default `connect()` omits `capabilities` (or leaves it undefined). Covered in `client.integration.test.ts`.

**Exit criteria:** QR payload advertises capability; legacy flow unchanged.

---

## Phase 3 — Wallet Deferred OTP Display

Wallet reacts to dapp capability and waits for grant before showing OTP.

**File:** `packages/wallet-client/src/client.ts`

- [x] **3.1** In `handleMessage()`, during `CONNECTING`, route `otp-display-grant` to a new internal event (e.g. `otp_display_grant_received`).
- [x] **3.2** Ignore or no-op `otp-display-grant` when not in `CONNECTING` (defensive).

**File:** `packages/wallet-client/src/domain/connection-handler-context.ts`

- [x] **3.3** Add `once`/`off` support for `otp_display_grant_received` on the context interface.

**File:** `packages/wallet-client/src/handlers/untrusted-connection-handler.ts`

- [x] **3.4** After `_generateOtpWithDeadline()`, branch on `request.capabilities?.otpDisplayGrant`:
  - **Legacy path:** keep current behavior — emit `display_otp` immediately.
  - **Strict path:** do **not** emit `display_otp` yet.
- [x] **3.5** In `_sendHandshakeOffer()`, when strict, include `otpDisplayGrantRequired: true` on the payload.
- [x] **3.6** Add `_waitForOtpDisplayGrant(deadline)` — mirrors `_waitForHandshakeAck` pattern:
  - Listen for `otp_display_grant_received`.
  - Reject on deadline with a clear error (temporary `REQUEST_EXPIRED` or new code from Phase 5).
- [x] **3.7** On grant received, emit `display_otp` with the already-generated OTP and deadline.
- [x] **3.8** Reorder `execute()` for strict path:

```
generate OTP
→ send handshake-offer (otpDisplayGrantRequired: true)
→ wait for otp-display-grant
→ emit display_otp
→ wait for handshake-ack
→ finalize
```

**Tests**

- [x] **3.9** Unit test: legacy request (no capability) — `display_otp` fires before offer is sent (unchanged).
- [x] **3.10** Unit test: strict request — `display_otp` does **not** fire until grant event.
- [x] **3.11** Unit test: strict request — offer payload includes `otpDisplayGrantRequired: true`.
- [x] **3.12** Unit test: strict request — grant timeout rejects connection.

**Exit criteria:** Wallet strict path works in isolation (grant event can be simulated in unit tests); legacy path unchanged.

---

## Phase 4 — Dapp Grant Send & Strict Validation

Dapp sends grant on the **handshake channel** before OTP entry. Session creation stays after OTP (same as legacy).

**File:** `packages/dapp-client/src/handlers/untrusted-connection-handler.ts`

- [x] **4.1** After `_waitForHandshakeOffer()`, validate strict mode:
  - If `requireOtpDisplayGrant` and offer lacks `otpDisplayGrantRequired`, reject with a dedicated error (no silent fallback).
- [x] **4.2** Add `_applyWalletPublicKeyFromOffer()` — set `theirPublicKey` from offer for encrypting handshake messages (no session channel yet).
- [x] **4.3** No early subscribe to session channel — dapp already subscribed to handshake channel.
- [x] **4.4** Add `_sendOtpDisplayGrant(handshakeChannel)`:
  - `await sendMessage(handshakeChannel, { type: "otp-display-grant" })`.
  - Only when strict mode is active.
- [x] **4.5** Reorder `execute()` for strict path:

```
wait offer
→ validate strict flags
→ set wallet public key from offer
→ send otp-display-grant (handshake channel)
→ handle OTP input
→ create final session + subscribe secure channel
→ handshake-ack
→ finalize
```

- [x] **4.6** For legacy path, keep existing order (OTP before session channel setup).

**Tests**

- [x] **4.7** Unit test: strict dapp + strict offer — grant is sent before `otp_required` is emitted.
- [x] **4.8** Unit test: strict dapp + offer without `otpDisplayGrantRequired` — rejects (compatibility matrix row: new dapp + old wallet).
- [x] **4.9** Unit test: legacy dapp + strict offer from wallet — N/A in practice (wallet only sets flag when dapp advertises capability); legacy path test covers default behavior.
- [x] **4.10** Unit test: legacy dapp + legacy offer — unchanged flow.

**Exit criteria:** Full strict handshake works in unit tests with mocked transport/events.

---

## Phase 5 — Error Codes & Timeouts

**File:** `packages/core/src/domain/errors.ts`

- [x] **5.1** Add error codes (names tentative, align with existing style):
  - `OTP_DISPLAY_GRANT_REQUIRED` — strict dapp received offer without `otpDisplayGrantRequired`.
  - `OTP_DISPLAY_GRANT_TIMEOUT` — wallet did not receive grant in time.
- [x] **5.2** Use new codes in wallet `_waitForOtpDisplayGrant()` and dapp strict validation.
- [x] **5.3** Ensure dapp strict-mode failure surfaces via `error` event / rejected `connect()` promise with actionable message.

**Edge cases to handle**

- [x] **5.4** User cancels OTP after grant was sent — wallet should reject/tear down (existing cancel path).
- [x] **5.5** Request expires while waiting for grant — both sides clean up (existing timeout machinery).
- [x] **5.6** Multiple `handshake-offer` messages (front-run scenario) — dapp accepts first offer only (`once` listener); acceptable DoS per spec.

**Exit criteria:** All failure paths have explicit error codes; no silent downgrade.

---

## Phase 6 — Unit Test Coverage

Consolidate and fill gaps across both clients.

**Dapp handler tests** (`packages/dapp-client/src/handlers/untrusted-connection-handler.test.ts`)

- [x] **6.1** Full strict flow happy path (offer → grant → OTP → ack → connected).
- [x] **6.2** Strict rejection when offer missing flag.
- [x] **6.3** OTP incorrect / max attempts / expired — still work in strict mode.
- [x] **6.4** Offer timeout — still works (existing test).

**Wallet handler tests** (`packages/wallet-client/src/handlers/untrusted-connection-handler.test.ts`)

- [x] **6.5** Full strict flow happy path.
- [x] **6.6** Grant timeout.
- [x] **6.7** Legacy flow regression suite (no capability in request).

**Client-level tests**

- [x] **6.8** `packages/dapp-client/src/client.integration.test.ts` — session request includes capability when flag set.
- [x] **6.9** `packages/wallet-client/src/client.integration.test.ts` — `handleMessage` routes `otp-display-grant` correctly.

**Exit criteria:** Unit tests cover compatibility matrix rows that do not need a live relay.

---

## Phase 7 — Integration Tests & Compatibility Matrix

**File:** `apps/integration-tests/src/end-to-end.integration.test.ts`

- [x] **7.1** Add helper `connectClientsStrict()` mirroring existing `connectClients()` but with `requireOtpDisplayGrant: true`.
- [x] **7.2** E2E: strict dapp + strict wallet — full connect + bidirectional messaging.
- [x] **7.3** E2E: strict dapp + legacy wallet simulation — expect clean failure (`OTP_DISPLAY_GRANT_REQUIRED` or timeout waiting for grant on wallet side).
- [x] **7.4** E2E: legacy dapp + strict-capable wallet — legacy flow still works.
- [x] **7.5** Assert timing: in strict E2E, `display_otp` on wallet fires **after** dapp receives offer (not before).

**Compatibility matrix verification**

| Pair | Test |
| --- | --- |
| Old dapp + old wallet | 7.4 (legacy path) |
| Old dapp + new wallet | 7.4 |
| New dapp without flag + old wallet | 7.4 |
| New dapp with flag + old wallet | 7.3 |
| New dapp with flag + new wallet | 7.2 |

**Exit criteria:** All five matrix rows covered by automated tests.

---

## Phase 8 — Demos & Documentation

**File:** `apps/web-demo/src/components/UntrustedDemo.tsx`

- [ ] **8.1** Add UI toggle (or query param) for `requireOtpDisplayGrant`.
- [ ] **8.2** Pass flag through to `dappClient.connect()`.
- [ ] **8.3** Show user-facing error when strict mode fails (old wallet).

**File:** `docs/02-connection-flow.md`

- [ ] **8.4** Add subsection for strict untrusted flow with updated sequence diagram.
- [ ] **8.5** Document `requireOtpDisplayGrant` and `capabilities.otpDisplayGrant`.
- [ ] **8.6** Note that `otp-display-grant` is distinct from `handshake-ack`.

**RN demo** (`apps/rn-demo`)

- [ ] **8.7** No protocol changes expected; verify OTP modal still appears at the correct time in strict E2E manual test.

**Exit criteria:** Docs and demo reflect new flow; manual smoke test passes.

---

## Phase 9 — Final Verification

Follow [`.cursor/rules/verify.mdc`](../.cursor/rules/verify.mdc).

- [ ] **9.1** Run full test suite (unit + integration).
- [ ] **9.2** Run typecheck / lint across affected packages.
- [ ] **9.3** Manual smoke test: web-demo strict mode with two browser tabs (dapp + wallet simulation if available).
- [ ] **9.4** Review PR sequence: types → wallet → dapp → tests → docs (or types → dapp flag → wallet → dapp grant → tests → docs).

**Exit criteria:** Feature complete per [otp-display-grant-plan.md](./otp-display-grant-plan.md).

---

## Suggested PR Sequence

Smaller PRs are easier to review. Recommended order:

1. **PR 1 — Types** (Phase 1)
2. **PR 2 — Dapp flag & session request** (Phase 2)
3. **PR 3 — Wallet deferred display** (Phase 3 + wallet unit tests)
4. **PR 4 — Dapp grant & strict validation** (Phase 4 + Phase 5 + dapp unit tests)
5. **PR 5 — Integration tests & demos** (Phases 7–8)

Phases 0 and 9 are checklist steps, not standalone PRs.

---

## Key Code Touchpoints (Quick Reference)

| File | Change |
| --- | --- |
| `packages/core/src/domain/session-request.ts` | `capabilities.otpDisplayGrant` |
| `packages/core/src/domain/protocol-message.ts` | `OtpDisplayGrant`, `otpDisplayGrantRequired` |
| `packages/core/src/domain/errors.ts` | New error codes |
| `packages/dapp-client/src/client.ts` | `requireOtpDisplayGrant`, session request |
| `packages/dapp-client/src/handlers/untrusted-connection-handler.ts` | Reordered strict flow, grant send |
| `packages/wallet-client/src/client.ts` | Route `otp-display-grant` |
| `packages/wallet-client/src/handlers/untrusted-connection-handler.ts` | Deferred `display_otp`, grant wait |

---

## Open Questions (Resolve Before Phase 4)

1. **Multiple offers:** If a front-running attacker sends an offer first, strict dapp accepts it, sends grant to attacker's channel, and real wallet never gets a grant. Is that acceptable DoS (per spec), or should dapp wait/retry for a wallet offer with known characteristics?
   - **Resolved:** Accept DoS — intended threat model trade-off.
2. **Grant timeout vs OTP deadline:** Should grant timeout share the 60s OTP window or use a separate shorter window?
   - **Resolved:** Reuse `deadline` from the offer (wallet already does this).
3. **Encrypted grant on handshake channel:** Grant is encrypted to the accepted offer's wallet public key via `_applyWalletPublicKeyFromOffer()` before `sendMessage` on the handshake channel.
   - **Pending:** Verify in Phase 4 unit test with mocked crypto path.
