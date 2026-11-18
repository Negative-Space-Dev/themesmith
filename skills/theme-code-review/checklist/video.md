# Video

- **id:** video
- **applies-when:** The code embeds video — a `<video>` element, a Shopify
  `video_tag`/`external_video_url`, or a YouTube/Vimeo `<iframe>`.
- **detect-signal:** `<video`, `video_tag`, `external_video`, `youtube`, `vimeo`

---

#### VID-01 — Provide a poster image

- **applies-when:** a `<video>` element is rendered
- **check:** auto
- **fix:** propose
- **severity:** high
- **rule:** rules/video-poster-image.mdc

#### VID-02 — Don't autoplay with sound

- **applies-when:** a `<video autoplay>` is present
- **check:** auto
- **fix:** propose
- **severity:** high
- **rule:** rules/video-autoplay-requires-muted.mdc

#### VID-03 — Default lazy-load video (with known exceptions)

- **applies-when:** a `<video>` or video `<iframe>` is rendered
- **check:** auto
- **fix:** auto
- **severity:** medium
- **rule:** rules/video-lazy-load-offscreen.mdc

#### VID-04 — Accessible controls / no keyboard trap

- **applies-when:** a `<video>` is interactive (not a muted decorative loop)
- **check:** manual
- **fix:** manual
- **severity:** high
- **rule:** rules/video-accessible-controls.mdc
