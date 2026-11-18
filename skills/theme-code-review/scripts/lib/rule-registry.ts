/**
 * Rule registry: stable check ID → semantic filename + agent-friendly description.
 * Run: bun scripts/sync-rule-registry.ts
 */

export type RuleEntry = {
  id: string;
  slug: string;
  title: string;
  description: string;
};

export const RULE_REGISTRY: RuleEntry[] = [
  // Images
  {
    id: "IMG-01",
    slug: "image-explicit-width-height",
    title: "Set explicit width and height on raw images",
    description:
      "Use when Shopify theme code renders a raw <img> tag or a non-Shopify image source that needs explicit dimensions. Do not require width/height on image_tag when the input is a Shopify image object because image_tag emits dimensions by default.",
  },
  {
    id: "IMG-02",
    slug: "image-lazy-load-below-fold",
    title: "Default lazy-load images (with known exceptions)",
    description:
      "Use when building or editing a Shopify section/component with images. Default to loading=lazy unless the section is a hero, image banner, or main product section first image — placement above the fold is not reliably knowable.",
  },
  {
    id: "IMG-03",
    slug: "image-responsive-srcset",
    title: "Responsive srcset / widths",
    description:
      "Use when building or editing a Shopify section/component that renders content, product, collection, hero, or gallery images. Prefer image_tag widths/srcset and sizes so images are responsive.",
  },
  {
    id: "IMG-04",
    slug: "image-alt-text",
    title: "Meaningful alt text on raw images; empty alt for decorative",
    description:
      "Use when Shopify theme code renders a raw <img> tag or a non-Shopify image source that needs an explicit alt attribute. Do not require alt: on image_tag when the input is a Shopify image object because image_tag uses the object's alt text by default.",
  },
  {
    id: "IMG-05",
    slug: "image-prefer-image-tag-over-raw-img",
    title: "Prefer image_tag over raw <img> and hardcoded URLs",
    description:
      "Use when building or editing Shopify theme image markup with raw <img> tags or hardcoded image URLs. Prefer image_tag/image_url from Shopify image objects; confirm intentional exceptions.",
  },
  {
    id: "IMG-06",
    slug: "picture-fallback-img",
    title: "picture element has fallback img",
    description:
      "Use when building or editing art-directed Shopify image markup with <picture> or multiple <source> elements. Ensure the picture includes a fallback <img> with image rules applied.",
  },
  {
    id: "IMG-07",
    slug: "image-intrinsic-size-retina-buffer",
    title: "Intrinsic image size ≥ 1.5–2× rendered size",
    description:
      "Use when building or editing Shopify sections/components with content, product, hero, or gallery images. Manually verify the largest requested source width is at least 1.5–2× the image's rendered CSS size for sharp retina display.",
  },
  // Video
  {
    id: "VID-01",
    slug: "video-poster-image",
    title: "Provide a poster image",
    description:
      "Use when building or editing a Shopify section/component that renders a <video>, video banner, product media video, or background video. Provide a poster image so the video has a stable preview frame.",
  },
  {
    id: "VID-02",
    slug: "video-autoplay-requires-muted",
    title: "Don't autoplay with sound",
    description:
      "Use when building or editing a Shopify section/component with autoplaying video, video banners, background video, or product media video. Autoplaying videos must include muted and playsinline.",
  },
  {
    id: "VID-03",
    slug: "video-lazy-load-offscreen",
    title: "Default lazy-load video (with known exceptions)",
    description:
      "Use when building or editing Shopify theme video markup. Default to lazy-video snippet pattern (data-lazy-video + lazy-video.js); skip for hero, video banner, or first product media video.",
  },
  {
    id: "VID-04",
    slug: "video-accessible-controls",
    title: "Accessible controls / no keyboard trap",
    description:
      "Use when building or editing Shopify video UI with play/pause, mute, carousel video, product media, embedded video, or custom video controls. Ensure interactive video has accessible controls and no keyboard trap.",
  },
  // Modals
  {
    id: "MODAL-01",
    slug: "modal-use-semantic-dialog",
    title: "Use semantic dialog",
    description:
      "Use when building or editing Shopify modal, drawer, popup, quick-view, newsletter, cart drawer, size guide, or popover UI. Modal containers need semantic <dialog> or role=\"dialog\" markup.",
  },
  {
    id: "MODAL-02",
    slug: "modal-accessible-name",
    title: "Accessible name",
    description:
      "Use when building or editing Shopify modal, drawer, popup, quick-view, newsletter, cart drawer, size guide, or popover UI. Dialogs need an accessible name via aria-label or aria-labelledby.",
  },
  {
    id: "MODAL-03",
    slug: "modal-focus-trap-restore",
    title: "Focus management (trap + restore)",
    description:
      "Use when building or editing JavaScript that opens a Shopify modal, drawer, popup, quick-view, cart drawer, or popover over the page. Move focus in, trap focus while open, and restore focus on close.",
  },
  {
    id: "MODAL-04",
    slug: "modal-close-escape-backdrop",
    title: "Close on Escape and backdrop click",
    description:
      "Use when building or editing JavaScript for Shopify modals, drawers, popups, quick-view, cart drawer, or popover UI. Support Escape close and expected backdrop/outside-click dismissal.",
  },
  {
    id: "MODAL-05",
    slug: "modal-prevent-background-scroll",
    title: "Prevent background scroll while open",
    description:
      "Use when building or editing Shopify full-screen modals, drawers, cart drawer, mobile menu, quick-view, or overlay UI. Lock background page scroll while the overlay is open.",
  },
  {
    id: "MODAL-06",
    slug: "modal-inert-background",
    title: "Inert/aria-hidden the rest of the page",
    description:
      "Use when building or editing Shopify modal or drawer UI that overlays the page with aria-modal behavior. Make background content inert or aria-hidden while the overlay is open.",
  },
  // Liquid performance
  {
    id: "LIQUID-01",
    slug: "liquid-no-nested-loops",
    title: "No nested loops over large collections",
    description:
      "Use when building or editing Shopify Liquid sections/snippets with a {% for %} loop inside another loop, especially over products, variants, collections, blocks, menus, or metafield lists. Avoid expensive nested iteration.",
  },
  {
    id: "LIQUID-02",
    slug: "liquid-limit-collection-loops",
    title: "Limit loops with limit: or pagination",
    description:
      "Use when building or editing Shopify Liquid sections/snippets that loop over collection.products, collections, search results, blocks, menus, or large arrays. Add limit: or paginate for collection-sized loops.",
  },
  {
    id: "LIQUID-03",
    slug: "liquid-avoid-global-lookups",
    title: "Avoid unscoped global collection lookups",
    description:
      "Use when building or editing Shopify Liquid that references all_products, collections['handle'], collections.handle, linklists, or hardcoded global lookups. Prefer scoped section/block settings or current template objects.",
  },
  {
    id: "LIQUID-04",
    slug: "liquid-use-render-not-include",
    title: "Use render instead of deprecated include",
    description:
      "Use when building or editing Shopify Liquid snippets, sections, or legacy theme code that contains {% include %}. Replace include with {% render %} and pass needed values explicitly.",
  },
  {
    id: "LIQUID-05",
    slug: "liquid-hoist-invariant-out-of-loops",
    title: "Hoist invariant work out of loops",
    description:
      "Use when building or editing Shopify Liquid loops where assign, capture, expensive filters, settings lookups, or repeated calculations inside the loop do not depend on the current loop item. Hoist invariant work above the loop.",
  },
  {
    id: "LIQUID-06",
    slug: "liquid-avoid-date-operations",
    title: "Avoid cache-breaking date operations",
    description:
      "Use when building or editing Shopify Liquid that uses 'now' | date, current-time comparisons, countdowns, sale timers, new badges, expiry dates, or time-based visibility. Avoid cache-breaking current-time logic in Liquid.",
  },
  {
    id: "LIQUID-07",
    slug: "liquid-avoid-passing-objects-to-snippets",
    title: "Avoid passing whole objects to snippets",
    description:
      "Use when building or editing Shopify snippets/components rendered with {% render %}, especially product cards, variant UI, badges, media, or price snippets. Pass only the primitive values the snippet needs instead of whole product/variant/collection objects.",
  },
  {
    id: "LIQUID-08",
    slug: "liquid-avoid-unnecessary-json",
    title: "Avoid unnecessary JSON serialization",
    description:
      "Use when building or editing Shopify Liquid that passes data to JavaScript with | json, data attributes, script tags, product cards, variant pickers, or cart UI. Serialize only the fields JS needs, not full product/collection/cart objects.",
  },
  {
    id: "LIQUID-09",
    slug: "liquid-break-loops-early",
    title: "Break loops early when a match is found",
    description:
      "Use when building or editing Shopify Liquid loops that search for one matching product, variant, option, swatch, tag, block, or metafield value. Add {% break %} after the match is found.",
  },
  {
    id: "LIQUID-10",
    slug: "liquid-prefer-section-settings-over-hardcoded-refs",
    title: "Prefer section settings over hardcoded global references",
    description:
      "Use when building or editing configurable Shopify sections/blocks that reference collection handles, product handles, metafield namespaces/keys, badge text, content sources, or settings directly. Prefer schema settings and dynamic sources.",
  },
  {
    id: "LIQUID-11",
    slug: "liquid-prefer-array-filters-over-loops",
    title: "Prefer Liquid array filters over manual loops",
    description:
      "Use when building or editing Shopify Liquid that loops only to find, filter, map, or test items in arrays such as variants, options, tags, blocks, metafields, or collections. Prefer find, where, map, has, first, or compact.",
  },
  {
    id: "LIQUID-12",
    slug: "liquid-abstract-repeated-logic-to-snippets",
    title: "Abstract repeated logic to snippets",
    description:
      "Use when building or editing Shopify sections/components with repeated Liquid markup, duplicated conditionals, repeated badge/card/media logic, or large copy-pasted blocks. Extract shared logic to snippets rendered with explicit arguments.",
  },
  // Tailwind
  {
    id: "TW-01",
    slug: "tailwind-minimize-arbitrary-values",
    title: "Minimize arbitrary Tailwind values",
    description:
      "Use when Shopify theme markup or CSS uses Tailwind arbitrary values like w-[347px], text-[14px], or gap-[17px]. Prefer default Tailwind scale first, then existing or new theme config tokens; use arbitrary values only when no close value exists and the value should not enter the theme system.",
  },
  {
    id: "TW-02",
    slug: "tailwind-extend-theme-config",
    title: "Extend Tailwind config before one-off values",
    description:
      "Use when a Shopify theme Tailwind class needs a custom spacing, sizing, color, font, radius, or breakpoint value that does not exist in the default scale but should be reused or kept consistent. Add the value to tailwind.config following project patterns instead of repeated arbitrary utilities.",
  },
  {
    id: "TW-03",
    slug: "tailwind-prefer-theme-colors",
    title: "Prefer theme colors over hardcoded arbitrary colors",
    description:
      "Use when Shopify theme Tailwind classes use arbitrary color values like bg-[#hex], text-[rgb(...)], or border-[hsl(...)] instead of colors defined in tailwind.config. Prefer existing theme color tokens (semantic names, nested palettes).",
  },
];

export const RULE_BY_ID = Object.fromEntries(
  RULE_REGISTRY.map((entry) => [entry.id, entry]),
);

export const RULE_BY_SLUG = Object.fromEntries(
  RULE_REGISTRY.map((entry) => [entry.slug, entry]),
);
