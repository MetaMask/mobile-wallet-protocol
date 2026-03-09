# Daily Kickoff - Monday, March 9, 2026

## Needs Reply

- [ ] **Alex Donesky** asks: Handle WAPI-1160 (release new MWP version with audit changes, pull into consumers). He notes you've "officially moved teams" so wants to know if you can still do this or if the team should take it over.
  Team DM group (#mpdm-alex.donesky--joao.carlos--jiexi.luan--tamas.soos) - posted Sunday ~3:15 AM UTC

- [ ] **Standup thread** in #wallet-integrations: Daily standup bot posted at 7:00 AM UTC. Need to post your plan for the day.

## Today's Focus

1. **WAPI-1160** - Release new version of mobile wallet protocol + pull into consumers (High priority). Alex specifically asked you for this. Cut a release incorporating all audit changes, integrate into mm-connect and mobile app, create a changelog.md.
2. **Reply to Alex** about whether you can take WAPI-1160 given the team move, or if it needs to be handed off.
3. **Standup update** before the 16:30 CET meeting.

## Active Work

| Ticket | What | Status | Priority | Last Updated |
|--------|------|--------|----------|--------------|
| WAPI-1160 | Release new MWP version + pull into consumers | To Do | High | Mar 6 |

## New Since Last Check

- Alex posted a big planning update (Sunday) assigning work for the week:
  - E2E tests (WAPI-1044, WAPI-1154) assigned to alex.mendonca
  - Dynamic connector handoff from you is being picked up by alex.mendonca
  - WAPI-1152 (Zapier BrowserStack alerts) and WAPI-1141 (Refactor notification flow) assigned to joao.carlos
  - After WAPI-1160, team does one last testing sweep before merging/releasing WAGMI
- Alex cancelled audit tickets WAPI-1121 (nonce poisoning), WAPI-1144 (HMAC envelope), WAPI-1145 (Centrifugo publish)
- Alex moved WAPI-1130 (session expiry check) and WAPI-163 (BE alerts) to Done
- BrowserStack: 15/15 performance test builds had errors over the weekend (iOS + Android)

## Meetings Today

- 16:30-17:00 CET - **Wallet Integrations standup** - Prep: have standup update ready, know status of WAPI-1160

## Email (needs attention)

- Nothing actionable. All inbox items are Jira notifications (already captured above), newsletters (Socket Weekly, Consensys Intelligence Briefing), MetaMask mobile releases digest, BrowserStack daily summary, and internal comms from Legal.

## Open PRs (yours)

- public-wallet-connectors#1 - feat(metamask): integrate MetaMask Connect EVM/Solana SDK - open (updated Mar 6)
- Consensys/observability-tenants#3701 - feat(mmcx): add Prometheus alerts for relay server - open (updated Feb 24)
- MetaMask/metamask-sdk#1361 - Refactor Analytics Client for V2 Namespaced Events - open (stale, Oct 2025)

## Backlog (not urgent)

| Ticket | What | Status |
|--------|------|--------|
| WAPI-907 | Swap to AWS-based Load Testing Infrastructure | Blocked |
| WAPI-906 | Setup On-Call Rotation | Blocked |
| NOTIFY-1149 | Create Push replica DB | In Review (stale) |
| NOTIFY-1187 | Internal Architecture Docs for W3N | In Progress (stale) |
| NOTIFY-1175 | Testing W3N Part 1 | In Progress (stale) |
| NOTIFY-1151 | Write future of web3alerts document | In Review (stale) |
| NOTIFY-1176 | W3N next Q plan | In Review (stale) |
| NOTIFY-377 | Run a license report against all backend repos | To Do (stale) |
| NOTIFY-917 | Write nice docs, make it developer friendly | To Do (stale) |
| NOTIFY-555 | Setup metrics + logging | To Do (stale) |
| NOTIFY-545 | NFD - Trigger API | To Do (stale) |
