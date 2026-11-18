# Modals & dialogs

- **id:** modals-dialogs
- **applies-when:** The code renders a modal, dialog, drawer, off-canvas panel,
  or popover.
- **detect-signal:** `<dialog`, `modal`, `drawer`, `popover`, `aria-modal`,
  `role="dialog"`

---

#### MODAL-01 — Use semantic dialog (`<dialog>` or `role="dialog"`)

- **applies-when:** an element behaves as a modal/dialog
- **check:** auto
- **fix:** propose
- **severity:** high
- **rule:** rules/modal-use-semantic-dialog.mdc

#### MODAL-02 — Accessible name

- **applies-when:** a dialog/modal is present
- **check:** auto
- **fix:** propose
- **severity:** high
- **rule:** rules/modal-accessible-name.mdc

#### MODAL-03 — Focus management (trap + restore)

- **applies-when:** a modal opens over the page
- **check:** manual
- **fix:** propose
- **severity:** high
- **rule:** rules/modal-focus-trap-restore.mdc

#### MODAL-04 — Close on Escape and backdrop click

- **applies-when:** a modal opens over the page
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/modal-close-escape-backdrop.mdc

#### MODAL-05 — Prevent background scroll while open

- **applies-when:** a full-screen modal/drawer opens
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/modal-prevent-background-scroll.mdc

#### MODAL-06 — Inert/aria-hidden the rest of the page

- **applies-when:** a modal with `aria-modal` is present
- **check:** manual
- **fix:** propose
- **severity:** low
- **rule:** rules/modal-inert-background.mdc
