# PageScaffold

`PageScaffold` is the canonical page organism for PrintOps.

It owns:

- page width and density
- document order
- grid placement for header, body, detail, and footer
- detail/footer separators and responsive spacing

It does not own:

- API loading
- permissions
- domain status decisions
- localized copy
- action eligibility

Pass a semantic `PageHeader` (or the `PageLayout` compatibility header) through the `header` slot. The scaffold adds a non-semantic placement wrapper so it does not create nested header landmarks.
