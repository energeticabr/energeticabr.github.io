# On-demand workers implementation plan

> **For agentic workers:** Execute inline using superpowers:executing-plans; use a fresh reviewer for the completed branch.

**Goal:** Wake existing manual DDA/fiscal Windows tasks from server queue events.

**Architecture:** An authenticated persistent SSH stream observes queue files with Linux inotify. A windowless Windows agent accepts only fixed queue names and starts existing tasks without changing their business commands. Preserve scheduled collection, cooldowns and existing queue acknowledgements.

**Tech Stack:** Python standard library, PowerShell 7, existing OpenSSH and Task Scheduler.

**Spec:** ../specs/2026-11-01-on-demand-workers-design.md

## Global constraints

- Preserve automatic task schedules, all fiscal cursors, financial data, authorization and receipts.
- No mobile source changes; deploy the shared server and Windows runtime.
- Production paths must work outside packaged-app filesystem virtualization.
- Tests must use isolated queue roots and benign tasks.

## Tasks

1. [x] Add `backend-patches/on-demand-workers/demand_watch.py` and unittest coverage. Test queued DDA, leased fiscal requests, due/future retries, terminal/empty queues, atomic file replacement and initial recovery. Implement inotify wait, bounded fixed-name event stream, periodic availability heartbeat and disconnect exit. Run red then green and all patch tests.
2. [x] Add `DemandAgent.psm1`, `Start-DemandAgent.ps1` and a PowerShell test harness. Test invalid event rejection, fixed dispatch, concurrent-run suppression, startup recovery, windowless process startup and reconnect handling. Keep a single resident instance. Run red then green.
3. [x] Add installation/reversal scripts, back up the exact current tasks, deploy server watcher without modifying the portal, and test a real SSH notification against isolated queues and a benign Windows scheduled task. Only then remove manual minute triggers and install the logon agent. Verify actual installed runtime and automatic schedules.
4. [ ] Review the whole change, address findings, publish the tracked code and shared backend, and verify sustained idle operation plus event delivery. Record independent deployment evidence and limitations.

## Review focus

- A due retry must wake without another filesystem write.
- A running global fiscal lease must block dispatch for other fiscal requests.
- Reconnect must rediscover queued work; duplicate events must not create concurrent task instances.
- Heartbeat-only writes must not launch idle tasks.
- Never interpolate an event into an executable command, task name or shell text.
