---
name: ui-ux-pro-max
description: "Evaluate UI accessibility, layout and interaction patterns for a design task."
---

# UI/UX reference

Use the relevant design criteria for the requested page or interaction. This
repository uses React and Vite; preserve `src/components/ui/` and the tokens in
`src/index.css`. Do not generate a new design system for an isolated component fix.

The vendored copy contains written guidance, not the upstream searchable data
or `scripts/search.py`. Use the references directly; do not install a CLI or
pretend a search ran. Numeric recommendations are design heuristics and need
context-specific validation.

- [accessibility-interaction.md](references/accessibility-interaction.md):
  keyboard, labels, touch targets and interaction feedback.
- [layout-style.md](references/layout-style.md): rendering, responsive layout,
  typography and color.
- [flows-data.md](references/flows-data.md): motion, forms, navigation and charts.
- [review.md](references/review.md): visual review of the affected UI.

Read only the category needed. Verify the changed states and relevant viewport
sizes; expand to a full-site audit only when that is the requested scope.
