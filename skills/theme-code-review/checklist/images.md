# Images

- **id:** images
- **applies-when:** The code under review renders one or more images (`<img>`,
  `{{ ... | image_tag }}`, `image_url`/`image_tag` filters, or a `<picture>`).
- **detect-signal:** `<img`, `image_tag`, `image_url`, `<picture`, `srcset`

---

#### IMG-01 — Set explicit width and height on raw images

- **applies-when:** a raw `<img>` is rendered, or the image is from a
  non-Shopify source that does not get dimensions from `image_tag` by default
- **check:** auto
- **fix:** auto
- **severity:** low
- **rule:** rules/image-explicit-width-height.mdc

#### IMG-02 — Default lazy-load images (with known exceptions)

- **applies-when:** an `<img>` is rendered
- **check:** manual
- **fix:** auto
- **severity:** high
- **rule:** rules/image-lazy-load-below-fold.mdc

#### IMG-03 — Responsive srcset / widths

- **applies-when:** an `<img>` renders a content/product image (not a tiny icon)
- **check:** auto
- **fix:** propose
- **severity:** medium
- **rule:** rules/image-responsive-srcset.mdc

#### IMG-04 — Meaningful alt text on raw images; empty alt for decorative

- **applies-when:** a raw `<img>` is rendered, or the image is from a
  non-Shopify source that does not get alt text from `image_tag` by default
- **check:** auto
- **fix:** auto
- **severity:** high
- **rule:** rules/image-alt-text.mdc

#### IMG-05 — Prefer image_tag over raw `<img>` and hardcoded URLs

- **applies-when:** markup uses a raw `<img>` tag or a hardcoded image URL in `src`
- **check:** auto
- **fix:** propose
- **severity:** medium
- **rule:** rules/image-prefer-image-tag-over-raw-img.mdc

#### IMG-06 — `<picture>` art-direction has matching fallback img

- **applies-when:** a `<picture>` element is present
- **check:** auto
- **fix:** propose
- **severity:** medium
- **rule:** rules/picture-fallback-img.mdc

#### IMG-07 — Intrinsic image size ≥ 1.5–2× rendered size

- **applies-when:** a content, product, hero, or gallery image is rendered (not a
  tiny icon, logo, or sprite)
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/image-intrinsic-size-retina-buffer.mdc
