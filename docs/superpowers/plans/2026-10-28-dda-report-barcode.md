# DDA report expandable barcode

Add a right-side chevron to each DDA report row. It toggles a full-width blue detail panel immediately below that row, containing the bank-provided barcode and an explicit copy button. Multiple rows may be open independently. Only the copy click writes to the clipboard, using the existing cross-platform clipboard helper and visible success/error feedback. Missing/invalid codes cannot be copied. Preserve expansion through filters, paging and refresh; clear on report close. Keep interactive detail panels out of the printed report and preserve the previous PDF readiness fix.

Validate toggle/copy/failed copy/missing code and print restoration with focused tests, then browser widths 320/390/desktop, build and signature guard. Independent review and publication to web/Windows, Play internal and TestFlight.
