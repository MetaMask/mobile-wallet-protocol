# OTP Display Grant — Implementation Plan

Companion to [otp-display-grant-plan.md](./otp-display-grant-plan.md). This document breaks the feature into small, reviewable phases. Each phase should land as an independent PR where possible.

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

| Phase | Goal | Depends on |
| --- | --- | --- |
| 0 | Baseline & guardrails | — |
| 1 | Core protocol types | 0 |
| 2 | Dapp connect options & session request | 1 |
| 3 | Wallet deferred OTP display | 1 |
| 4 | Dapp grant send & strict validation | 2, 3 |
| 5 | Error codes & timeouts | 4 |
| 6 | Unit tests | 2–5 |
| 7 | Integration tests | 6 |
| 8 | Demos & docs | 7 |

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

- [ ] **1.1** Extend `SessionRequest`:

```ts
capabilities?: {
  otpDisplayGrant?: true;
};
```

**File:** `packages/core/src/domain/protocol-message.ts`

- [ ] **1.2** Add `otpDisplayGrantRequired?: true` to `HandshakeOfferPayload`.
- [ ] **1.3** Add new message type:

```ts
export type OtpDisplayGrant = {
  type: "otp-display-grant";
};
```

- [ ] **1.4** Extend `ProtocolMessage` union to include `OtpDisplayGrant`.

**File:** `packages/core/src/index.ts`

- [ ] **1.5** Re-export `OtpDisplayGrant` (and any new error codes from Phase 5 if added in same PR).

**Exit criteria:** Packages compile; no runtime behavior change; existing tests still pass.

---

## Phase 2 — Dapp Connect Options & Session Request

Wire the dapp opt-in flag into the QR payload. Still uses the legacy flow internally.

**File:** `packages/dapp-client/src/client.ts`

- [ ] **2.1** Add `requireOtpDisplayGrant?: boolean` to `DappConnectOptions`.
- [ ] **2.2** In `_createPendingSessionAndRequest()`, when `requireOtpDisplayGrant === true`, set:

```ts
capabilities: { otpDisplayGrant: true }
```

on the emitted `SessionRequest`.
- [ ] **2.3** Pass `requireOtpDisplayGrant` (or derived flag) into the handler context so the untrusted handler can enforce strict mode later.

**File:** `packages/dapp-client/src/domain/connection-handler-context.ts`

- [ ] **2.4** Add context field or constructor arg for `requireOtpDisplayGrant: boolean` (default `false`).

**Tests (minimal for this phase)**

- [ ] **2.5** Unit test: `connect({ requireOtpDisplayGrant: true })` emits `session_request` with `capabilities.otpDisplayGrant === true`.
- [ ] **2.6** Unit test: default `connect()` omits `capabilities` (or leaves it undefined).

**Exit criteria:** QR payload advertises capability; legacy flow unchanged.

---

## Phase 3 — Wallet Deferred OTP Display

Wallet reacts to dapp capability and waits for grant before showing OTP.

**File:** `packages/wallet-client/src/client.ts`

- [ ] **3.1** In `handleMessage()`, during `CONNECTING`, route `otp-display-grant` to a new internal event (e.g. `otp_display_grant_received`).
- [ ] **3.2** Ignore or no-op `otp-display-grant` when not in `CONNECTING` (defensive).

**File:** `packages/wallet-client/src/domain/connection-handler-context.ts`

- [ ] **3.3** Add `once`/`off` support for `otp_display_grant_received` on the context interface.

**File:** `packages/wallet-client/src/handlers/untrusted-connection-handler.ts`

- [ ] **3.4** After `_generateOtpWithDeadline()`, branch on `request.capabilities?.otpDisplayGrant`:
  - **Legacy path:** keep current behavior — emit `display_otp` immediately.
  - **Strict path:** do **not** emit `display_otp` yet.
- [ ] **3.5** In `_sendHandshakeOffer()`, when strict, include `otpDisplayGrantRequired: true` on the payload.
- [ ] **3.6** Add `_waitForOtpDisplayGrant(deadline)` — mirrors `_waitForHandshakeAck` pattern:
  - Listen for `otp_display_grant_received`.
  - Reject on deadline with a clear error (temporary `REQUEST_EXPIRED` or new code from Phase 5).
- [ ] **3.7** On grant received, emit `display_otp` with the already-generated OTP and deadline.
- [ ] **3.8** Reorder `execute()` for strict path:

```
generate OTP
→ send handshake-offer (otpDisplayGrantRequired: true)
→ wait for otp-display-grant
→ emit display_otp
→ wait for handshake-ack
→ finalize
```

**Tests**

- [ ] **3.9** Unit test: legacy request (no capability) — `display_otp` fires before offer is sent (unchanged).
- [ ] **3.10** Unit test: strict request — `display_otp` does **not** fire until grant event.
- [ ] **3.11** Unit test: strict request — offer payload includes `otpDisplayGrantRequired: true`.
- [ ] **3.12** Unit test: strict request — grant timeout rejects connection.

**Exit criteria:** Wallet strict path works in isolation (grant event can be simulated in unit tests); legacy path unchanged.

---

## Phase 4 — Dapp Grant Send & Strict Validation

Dapp sends grant on the secure channel before OTP entry. This is the largest behavioral change.

**File:** `packages/dapp-client/src/handlers/untrusted-connection-handler.ts`

- [ ] **4.1** After `_waitForHandshakeOffer()`, validate strict mode:
  - If `requireOtpDisplayGrant` and offer lacks `otpDisplayGrantRequired`, reject with a dedicated error (no silent fallback).
- [ ] **4.2** Extract `_createProvisionalSession(session, offer)` from `_createFinalSession()`:
  - Set `channel` to `session:{offer.channelId}`.
  - Set `theirPublicKey` from `offer.publicKeyB64`.
  - Assign to `this.context.session` **before** OTP input.
- [ ] **4.3** Subscribe to the provisional secure channel (`await transport.subscribe(session.channel)`).
- [ ] **4.4** Add `_sendOtpDisplayGrant(session)`:
  - `await sendMessage(session.channel, { type: "otp-display-grant" })`.
  - Only when strict mode is active (offer has `otpDisplayGrantRequired`).
- [ ] **4.5** Reorder `execute()` for strict path:

```
wait offer
→ validate strict flags
→ create provisional session + subscribe secure channel
→ send otp-display-grant
→ handle OTP input
→ acknowledge handshake (handshake-ack)
→ finalize
```

- [ ] **4.6** For legacy path, keep existing order (OTP before session channel setup). Consider a small private method (`_isStrictFlow(offer)`) to avoid duplicating the full `execute()` body.

**Important implementation note:** `_acknowledgeHandshake()` today subscribes to the secure channel. In strict mode, subscription already happened in step 4.3 — make `_acknowledgeHandshake()` idempotent or skip re-subscribe when already subscribed.

**Tests**

- [ ] **4.7** Unit test: strict dapp + strict offer — grant is sent before `otp_required` is emitted.
- [ ] **4.8** Unit test: strict dapp + offer without `otpDisplayGrantRequired` — rejects (compatibility matrix row: new dapp + old wallet).
- [ ] **4.9** Unit test: legacy dapp + strict offer from wallet — still works (wallet only sends `otpDisplayGrantRequired` when dapp advertised capability, so this case should not occur in practice; document as impossible or add defensive handling).
- [ ] **4.10** Unit test: legacy dapp + legacy offer — unchanged flow.

**Exit criteria:** Full strict handshake works in unit tests with mocked transport/events.

---

## Phase 5 — Error Codes & Timeouts

**File:** `packages/core/src/domain/errors.ts`

- [ ] **5.1** Add error codes (names tentative, align with existing style):
  - `OTP_DISPLAY_GRANT_REQUIRED` — strict dapp received offer without `otpDisplayGrantRequired`.
  - `OTP_DISPLAY_GRANT_TIMEOUT` — wallet did not receive grant in time.
- [ ] **5.2** Use new codes in wallet `_waitForOtpDisplayGrant()` and dapp strict validation.
- [ ] **5.3** Ensure dapp strict-mode failure surfaces via `error` event / rejected `connect()` promise with actionable message.

**Edge cases to handle**

- [ ] **5.4** User cancels OTP after grant was sent — wallet should reject/tear down (existing cancel path).
- [ ] **5.5** Request expires while waiting for grant — both sides clean up (existing timeout machinery).
- [ ] **5.6** Multiple `handshake-offer` messages (front-run scenario) — dapp should only accept the first offer it processes; document behavior if a second offer arrives mid-flow.

**Exit criteria:** All failure paths have explicit error codes; no silent downgrade.

---

## Phase 6 — Unit Test Coverage

Consolidate and fill gaps across both clients.

**Dapp handler tests** (`packages/dapp-client/src/handlers/untrusted-connection-handler.test.ts`)

- [ ] **6.1** Full strict flow happy path (offer → grant → OTP → ack → connected).
- [ ] **6.2** Strict rejection when offer missing flag.
- [ ] **6.3** OTP incorrect / max attempts / expired — still work in strict mode.
- [ ] **6.4** Offer timeout — still works.

**Wallet handler tests** (`packages/wallet-client/src/handlers/untrusted-connection-handler.test.ts`)

- [ ] **6.5** Full strict flow happy path.
- [ ] **6.6** Grant timeout.
- [ ] **6.7** Legacy flow regression suite (no capability in request).

**Client-level tests**

- [ ] **6.8** `packages/dapp-client/src/client.integration.test.ts` — session request includes capability when flag set.
- [ ] **6.9** `packages/wallet-client/src/client.integration.test.ts` — `handleMessage` routes `otp-display-grant` correctly.

**Exit criteria:** Unit tests cover compatibility matrix rows that do not need a live relay.

---

## Phase 7 — Integration Tests & Compatibility Matrix

**File:** `apps/integration-tests/src/end-to-end.integration.test.ts`

- [ ] **7.1** Add helper `connectClientsStrict()` mirroring existing `connectClients()` but with `requireOtpDisplayGrant: true`.
- [ ] **7.2** E2E: strict dapp + strict wallet — full connect + bidirectional messaging.
- [ ] **7.3** E2E: strict dapp + legacy wallet simulation — expect clean failure (`OTP_DISPLAY_GRANT_REQUIRED` or timeout waiting for grant on wallet side).
- [ ] **7.4** E2E: legacy dapp + strict-capable wallet — legacy flow still works.
- [ ] **7.5** Assert timing: in strict E2E, `display_otp` on wallet fires **after** dapp receives offer (not before).

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
2. **Grant timeout vs OTP deadline:** Should grant timeout share the 60s OTP window or use a separate shorter window?
3. **Encrypted grant on secure channel:** Confirm `sendMessage` works once provisional `theirPublicKey` is set (wallet already subscribes to secure channel early — no wallet-side change needed for decryption).

Default answers aligned with the spec:

- (1) Accept DoS — that's the intended threat model trade-off.
- (2) Grant timeout should be bounded by the offer/request expiry; reuse `deadline` from the offer.
- (3) Verify in Phase 4 unit test with mocked crypto path.
