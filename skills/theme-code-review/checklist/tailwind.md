# Tailwind CSS

- **id:** tailwind
- **applies-when:** The code uses Tailwind utility classes (`class` /
  `className`), `@apply`, or Tailwind config.
- **detect-signal:** `class=`, `className`, `@apply`, `@tailwind`,
  `tailwind.config`

---

#### TW-01 — Minimize arbitrary Tailwind values

- **applies-when:** a utility class uses an arbitrary value (`w-[…]`, `bg-[…]`,
  `text-[…]`, etc.)
- **check:** auto
- **fix:** propose
- **severity:** medium
- **rule:** rules/tailwind-minimize-arbitrary-values.mdc

#### TW-02 — Extend Tailwind config before one-off values

- **applies-when:** a design value does not match the default scale but should
  be part of the theme system (recurring spacing, sizing, color, etc.)
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/tailwind-extend-theme-config.mdc

#### TW-03 — Prefer theme colors over hardcoded arbitrary colors

- **applies-when:** a color utility uses an arbitrary hex/rgb/hsl value instead
  of a theme token from `tailwind.config`
- **check:** auto
- **fix:** propose
- **severity:** medium
- **rule:** rules/tailwind-prefer-theme-colors.mdc
