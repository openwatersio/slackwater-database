# JMA tide stations

Import the 70 JMA-operated stations with published 60-constituent tables for 2026. Follow the JHOD pinned-response, offline-import pattern. Preserve published precision and zero amplitudes. Convert local-meridian phase with G = kappa - species * longitude, using the constants page longitude. Keep seasonal and short-period analysis years in pinned pages. Store datums in the MSL frame, preserve the published tide-table zero as CD and use it as the height reference. Retain derived NLLW independently. Preserve reviewed TICON JMA gauge positions through curated station positions; use JMA longitude independently for phase conversion. Retain TICON records and URLs when gauge identity is established; proximity alone is not identity.

## Approaches

The complete source integration was selected over a research-only pass. Reuse existing catalogue resolution and quality rules, with a JMA-specific parser and reviewed gauge crosswalk. No release is authorized. Compare imported predictions against JMA tables before declaring readiness. Record PDL 1.0 compatibility with CC BY 4.0, attribution and the editing notice.
