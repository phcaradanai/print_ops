---
version: 1
slug: "apps-web-src-pages-paperprofiles-tsx"
primary_target: "apps/web/src/pages/PaperProfiles.tsx"
related_targets: ["apps/web/src/features/paper-profiles/PaperProfileWorkspace.tsx"]
---

# Paper Profiles

- **Scope and mode:** `/paper-profiles` is an Operate surface for system administrators maintaining printer-ready paper definitions.
- **Job and task:** Existing-profile maintenance leads. Administrators find and assess a profile by code, name, dimensions, margins, orientation, DPI, and field count, then enter a focused editor. Creation and import remain secondary.
- **Direction:** Two stages—searchable profile library, then a focused editor with configuration and rendered-paper evidence kept together. Identity and physical dimensions lead; margins and dynamic fields follow; appearance, guides, presets, and design import are progressively disclosed.
- **Responsive behavior:** Desktop may split editor and preview. Mobile shows library or editor, never both; it keeps explicit back navigation and offers accessible numeric positioning alongside drag.
- **Safety and constraints:** Saving is explicit with current persistence semantics. Destructive deletion identifies the profile and requires confirmation. Preserve EN/TH, WCAG 2.1 AA, keyboard completeness, 44px touch targets, current data model, and the clinical Lab Notebook design world.
- **Anti-goals:** No freeform graphics-studio framing, blank-editor-first hierarchy, hidden measurements, invented versioning, or competing library/editor panes on mobile.
