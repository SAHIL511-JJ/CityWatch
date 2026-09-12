# CityWatch CRM UI patterns

- Use Verdana through the page `FONT` style and keep page content inside `mx-auto max-w-[1500px]` with a consistent vertical rhythm.
- Each top-level route owns one body-level `h1` through `PageHeader`. The shell breadcrumb is navigation context, not a second page heading.
- Put the primary action beside the page header on wide screens and let it wrap below the description on narrow screens. Use `Button` or a real `Link`, never a dead `#` target.
- Use `FeedbackPanel` for page-level empty/error results. Keep layout-shaped skeletons local so loading preserves the eventual geometry.
- Use cream (`#faf7f0`) as the page surface, dark green (`#14231a`) for primary actions, pale green for selected/operational context, and restrained warm-neutral borders.
- Every interactive control needs a visible dark-green focus ring, a hover/pressed state, and a disabled/pending state when it starts an asynchronous request.
- Prefer semantic `section`, `article`, `nav`, `ul`, and `Link` elements. Long content must wrap or truncate without creating horizontal overflow at 390px.
- Use progressive disclosure for secondary analytics. Closed disclosures need a visible chevron and an explicit Expand label.
