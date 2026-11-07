# CNO from registered correction letters

**Goal:** Consider registered CC-e alongside the original invoice. If the applicable correction contains the work CNO90.025.44060/72, show a green cluster with `CNO: 90.025.44060/72 - NOTA DE CORREÇÃO`.

**Architecture:** After exact same-row PDF byte verification, publish the validated CC-e metadata to hidden SharePoint Note field`CARTAS_CORRECAO_JSON`. The JSON contains version1, invoice key and an events array of immutable registered110110 events. Select the highest sequence correction that explicitly mentions a CNO; unrelated later corrections do not erase prior CNO corrections. The expected CNO in that correction overrides absent/wrong original CNO, including corrections quoting the old number. Wrong-only corrections and unrelated/invalid metadata never produce green. Preserve original XML/amounts, all PDFs, existing notifications, and signature gesture blocks.

**Metadata contract:** `{version:1,key,events:[{eventId,eventType:'110110',cStat:'135',sequence,protocol,issuedAt,correction,xmlSha256,pdfSha256,fileName}]}`. Event identity is `ID110110+key+two-digit-sequence`. Original invoice key must match. Update metadata under ETag after attachment verification; repeated events preserve identity, and all correction history remains available.

- [ ] App model/data/render and corrected-state browser tests at320/390/Windows/PWA.
- [ ] SharePoint field/flow metadata projection, exact receipts and one-time replay of seven existing letters.
- [ ] Persist validated correction evidence for the server CNO/WhatsApp analysis; baseline remains silent.
- [ ] Focused and complete suites, builds, signature guard, review and protected production update.
- [ ] Merge validated revision; verify web/Windows, Android internal and iOS TestFlight distribution independently.

User already authorized implementation and publication; no approval gate. Native worktree creation did not return, so fallback isolated worktree`app-cno-cce` from origin/main8571c274 was created. Domain agents handle app and Python analysis; coordinator handles metadata and releases.
