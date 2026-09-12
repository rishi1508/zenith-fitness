# 3.29.1 — 2026-09-13

Fixes to the "finish your account" screen Rishi hit first on 3.29.0:
- The mobile number field was invisible: the "+91" chip reused the input's
  full-width class and squeezed the field to zero. The code is now a picker
  (India first, fourteen more) and the number field takes the rest of the row.
- The screen — and the sign-in screen — is a fixed panel with no bounce,
  padded for the status bar, instead of a document that scrolled.
