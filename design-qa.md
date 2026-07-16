# Product Design QA — UE v15.13.0-20260715

## Comparison target

- Source visual truth: `docs/merge-reports/ue-v15.13.0-20260715/design-source/`
- Rendered implementation: `docs/merge-reports/ue-v15.13.0-20260715/design-implementation/`
- Full-view comparisons: `docs/merge-reports/ue-v15.13.0-20260715/design-comparison/01-comparison.png` through `10-comparison.png`
- Overview: `docs/merge-reports/ue-v15.13.0-20260715/design-comparison/00-contact-sheet.png`
- Viewports: desktop 1440×900; mobile 390×844.
- States: light list, dark list, risk filter open, detail loading, detail complete, mobile list, mobile detail, return dialog, two-row selection, and cockpit drawer detail.

## Evidence and fidelity review

The source and implementation were opened together in the same side-by-side comparison images. The focused comparisons are:

- `design-comparison/focus-01-list-header.png`: list hierarchy, tabs, search, filters, typography, spacing, tags, row actions, and semantic colors.
- `design-comparison/focus-04-loading.png`: drawer geometry, header, loading indicator, spacing, and overlay behavior.
- `design-comparison/focus-08-return-dialog.png`: modal width, radius, typography, labels, fields, button hierarchy, and overlay.

Required fidelity surfaces:

- Fonts and typography: passed. Both sides use the existing system font stack. Heading, tab, row title, metadata, tag, button, and form-control hierarchy have matching weight, scale, line height, truncation, and wrapping behavior.
- Spacing and layout rhythm: passed. The message-center hierarchy, list density, 4/6/8/12/16 px rhythm, row alignment, drawer width, mobile overlay, dialog geometry, radii, borders, and shadows match the UE target. Local customization controls and longer real-data copy add content without changing the UE component geometry.
- Colors and visual tokens: passed. Light and dark surfaces, brand red, blue links, purple AI accent, destructive/warning/success semantics, border contrast, and selected/disabled states match the source token intent.
- Image quality and asset fidelity: passed. The target contains no independent raster artwork. The implementation reuses the project icon-loading system and UE-provided component assets; no new font, icon library, image dependency, placeholder asset, or generated image was introduced.
- Copy and content: passed with intentional product constraints. `receivedAt` remains the primary local time semantic and `submittedAt` remains auxiliary. Local preview safety text, customization guidance, dynamic-column controls, original-document action, and unsupported-document warning remain visible. Fabricated detail fields from the UE preview are not reintroduced when the local detail contract reports an unsupported non-standard MDF document.

## Findings and comparison history

### Iteration 1

- [P2] Detail loading state added a skeleton block not present in the UE source.
  - Location: `skills/iuap-apcom-myapproval/web/index.html`, detail-loading rendering and CSS.
  - Evidence: the first `04-comparison.png` showed four shimmer rows beneath the spinner, while the UE target used one centered loading indicator.
  - Impact: the extra skeleton changed the loading-state composition and visual density.
  - Fix: removed the extra skeleton markup and shimmer styles while retaining the local asynchronous detail request and safety logic.

### Iteration 2

- Post-fix evidence: `design-comparison/04-comparison.png` and `design-comparison/focus-04-loading.png`.
- Result: the drawer now uses the UE centered spinner composition. No actionable P0, P1, or P2 visual differences remain.

Intentional differences that are not design drift:

- The implementation keeps local `receivedAt`/`submittedAt` semantics, dynamic-column controls, customization guidance, and full AI rationale.
- The implementation shows the local unsupported-document warning and omits preview-fabricated basic fields when the real detail contract has no structured fields.
- These differences preserve the approved functional and safety boundary; the surrounding UE layout, control form, position, theme, and responsive behavior remain unchanged.

## Interaction and responsive checks

- Search filtered to the expected row and cleared correctly through keyboard input.
- Risk dropdown selected “高风险” and returned only the two high-risk items.
- Row selection, batch state, detail open/loading/complete, return dialog, close/navigation controls, dark theme, mobile list/detail, and cockpit drawer states were exercised without approval submission.
- Mobile metrics: 390 px client width, 390 px scroll width, no horizontal overflow.
- Browser console errors/warnings for the final implementation capture: 0.

## Implementation checklist

- [x] Source and implementation captured at identical viewports and interaction states.
- [x] Full-view and focused side-by-side comparisons inspected.
- [x] P2 loading-state mismatch fixed and recaptured.
- [x] Typography, spacing, colors, assets, copy, interaction states, and responsiveness reviewed.
- [x] No actionable P0/P1/P2 findings remain.

## Follow-up polish

No blocking visual follow-up. Longer local AI rationale naturally increases some row heights relative to the short UE preview copy; this is accepted content-driven behavior, not a component mismatch.

final result: passed
