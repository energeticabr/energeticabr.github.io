# Provision settlement attachment verification

SharePoint automation can update a paid provision from `PAGAMENTO PREVISTO` to
`PAGAMENTO EFETUADO` while the settlement verifies its PDFs. It also normalizes
the actual payment timestamp. The old checks rejected this concurrent update
after the provision, order and launch had already been saved.

The patch accepts that status transition on a journal-confirmed child when the
SharePoint version advances by one, the payment still falls on the same São
Paulo calendar day, and every other checked field is unchanged. The attachment
SHA-256 checks, parent guard and financial link checks still apply.

Run `deploy.py` using the shared backend's virtual environment to check the
active source and run the regression. Run `deploy.py --apply` inside the
established maintenance gate to install the patch, restart both services and
check their health. This backend is shared by Android, iOS and Windows web.
