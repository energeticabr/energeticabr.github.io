# Presence supplier defaults

**Goal:** On submitting an edited attendance batch, ask whether to update the affected suppliers' defaults; a negative response only commits attendance.

**Approach:** Extend the existing durable server-side batch confirmation and journal so every client uses the same prompt and recovery. Resolve suppliers by exact registration with ambiguity protection, validate each activity/description pair, check SharePoint versions and read back changes. Keep the two server roots separate and install with the existing hash-checked, rollback-capable deploy pattern.

- [ ] Exercise yes, no, unchanged rows, ambiguous identities, conflicting values and interrupted writes with real workflow engine and fake services.
- [ ] Validate both independent server candidates and deployment/rollback safeguards.
- [ ] Review the change, publish backend, verify the installed service, and confirm the flow remains available from Android, iOS and Windows.
