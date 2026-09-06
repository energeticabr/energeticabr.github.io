# Power Apps Gallery Parity Design

## Objective

Make every portal gallery that maps to a Power Apps gallery reproduce the current Power Apps behavior from SharePoint data: visible fields, filters, search, default ordering, commands, attachments, and edit-form defaults.

## Source Of Truth

- The current published Canvas app is the behavioral source.
- SharePoint list and column metadata are the data-contract source.
- Generated gallery and form contracts are refreshed from a newly downloaded app export before parity decisions are made.
- The portal never embeds the Power Apps application.

## Coverage

The inventory starts with every `Gallery` control in the Canvas export. A gallery is in portal scope when its extracted `Items` source maps unambiguously to an entity in `portal/catalog/entities.js`. Auxiliary galleries used inside forms remain documented but are implemented through the related form control instead of receiving a separate portal route.

## Interface

- Every mapped gallery has a real text search input for its Power Apps search fields.
- Every single-value option filter is a searchable combobox with keyboard and pointer support; date ranges, toggles, and multi-value filters keep their specialized controls.
- Default sort follows the Power Apps formula when it can be proven. Users can select a sort field and reverse the direction with a visible arrow.
- Rows use the gallery contract's visible fields and expose only commands supported by the mapped operation and the user's permission.
- An attachment affordance appears only when attachments exist. It opens a viewer with PDF rendering, image preview, previous/next navigation, download, upload in editable forms, and backdrop dismissal.
- Edit forms load the selected SharePoint record and preserve exact Choice, Lookup, Person, multi-value, date, number, and text selections.

## Data Flow

The entity page resolves the SharePoint list and live columns, combines them with the generated Power Apps contract, builds a safe Graph query, and renders the result. Non-indexed or otherwise unsupported Power Apps queries use bounded client evaluation only when full-list pagination is available; metrics are calculated from the complete filtered set, not the visible page.

## Errors And Safety

Read failures show a retryable diagnostic without replacing data. Writes remain transactional: the visible gallery changes only after SharePoint confirms the mutation. Production verification may open and cancel edit/view operations; destructive commands and live saves are covered by automated tests unless separately confirmed at action time.

## Verification

- Contract tests cover every extracted gallery identity and mapped entity.
- Browser tests cover searchable filters, sorting, pagination, attachment viewer behavior, and edit preselection.
- The complete Node test suite must pass.
- Authenticated production validation traverses every mapped route, records HTTP failures, tests non-destructive filters/search/view/edit-cancel behavior, and checks desktop/mobile overflow.
