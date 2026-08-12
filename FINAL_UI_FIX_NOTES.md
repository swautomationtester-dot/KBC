# Final UI fix

The screenshot showed the Payment Review modal being clipped by the viewport,
with the page/footer visible behind it and an awkward nested scroll area.

Fixed:
- Payment Review and Host Login modals are now true full-viewport overlays.
- Modal card is centered on desktop and top-aligned safely on short/mobile screens.
- Only the modal card scrolls when its content is taller than the viewport.
- Background page scrolling is disabled while a modal is open.
- Payment form switches from 2 columns to 1 column on small screens.
- Added Escape-to-close for the payment modal.
- Cache-busted host stylesheet.
