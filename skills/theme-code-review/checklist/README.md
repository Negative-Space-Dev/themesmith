# Checklist category registry

Category **indexes** hold conditions and routing only. **Rules**
(`rules/<semantic-slug>.mdc`) hold examples and fix guidance — loaded by the
review skill only when a check fails or a manual item applies.

| id                   | index file               | applies-when (summary)                                    | detect signal (rough) |
|----------------------|--------------------------|-----------------------------------------------------------|------------------------|
| `images`             | `images.md`              | Code renders images                                       | `<img`, `image_tag`, `<picture` |
| `video`              | `video.md`               | Code embeds video                                         | `<video`, `youtube`, `vimeo` |
| `liquid-performance` | `liquid-performance.md`  | Loops, globals, JSON, dates, renders, repeated blocks     | `{% for`, `\| json`, `'now' \| date`, `{% assign` |
| `modals-dialogs`     | `modals-dialogs.md`      | Modal, dialog, drawer, or popover                         | `<dialog`, `modal`, `drawer` |
| `tailwind`           | `tailwind.md`            | Tailwind utility classes, `@apply`, or config             | `class=`, `@apply`, `tailwind.config`, `-[` |

## File layout

```
checklist/images.md          → index (conditions + check ID)
rules/image-explicit-width-height.mdc  → rule (id: IMG-01 in frontmatter)
scripts/lib/rule-registry.ts → ID ↔ slug map
```

## External sources

Liquid performance rules adapted from
[ProtonAgency/liquid-llm-rules](https://github.com/ProtonAgency/liquid-llm-rules/tree/main/liquid).
