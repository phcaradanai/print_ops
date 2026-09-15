# Molecular component review notes

This follow-up records the first internal review of the molecular page composition merged in PR #3.

## Findings addressed

1. `PageScaffold` exposed a `header` slot but did not assign that slot to the header grid area. Direct consumers depended on CSS auto-placement.
2. `PageScaffold.css` did not own the detail divider, footer layout, or touch-target behavior. The component still depended on legacy selectors in `styles.css`.
3. `PageHeader.css` changed the responsive collapse point from the existing 1024px behavior to 760px, creating a visual regression at tablet widths.
4. `SectionHeading.css` made the same breakpoint change, so section actions could remain squeezed between 761px and 1024px.
5. The initial server-render tests did not cover the custom `PageLayout.header` compatibility path, empty `PageHeader`, or header landmark count.

## Result

- Header placement is now explicit without taking semantic landmark ownership away from `PageHeader`.
- The scaffold owns its detail and footer presentation.
- Existing tablet behavior and 44px action targets are preserved.
- Compatibility tests cover both generated and custom headers.

## Remaining migration work

Legacy `.ops-page*` and `.ui-section-heading*` selectors still exist as compatibility styles. Remove or scope them only after all direct class consumers have migrated to the colocated components. Do not delete those selectors as part of an unrelated page migration.
