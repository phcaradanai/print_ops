# UI Quality Gate

## Product UI Principles

1. One screen, one primary purpose.
2. One decision block must have one primary action.
3. Reuse existing components before creating new ones.
4. Do not introduce new visual styles without approval.
5. Avoid nested cards deeper than 2 levels.
6. Prefer clarity over decoration.
7. Technical details belong in Advanced Details.
8. Empty, loading, error, and success states are required.
9. Mobile must be checked before acceptance.
10. UI text must explain what happened, why it matters, and what to do next.

## Forbidden UI Slop

- Random gradients
- Excessive shadows
- Too many cards
- Multiple competing CTA buttons
- Inconsistent spacing
- One-off colors
- New component for every feature
- Technical jargon in main user flow
- Dashboard full of equal-weight panels
- Important actions hidden below noisy content

## Acceptance

A UI change is accepted only if:
- test passes
- build passes
- primary action is obvious
- layout works on desktop and mobile
- no duplicate panels were added
- existing design system is respected