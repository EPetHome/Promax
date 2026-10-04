# Browser inspection checklist

## Load and layout

- Opens from the intended local path without a server when self-contained delivery is required.
- No missing fonts, icons, images, scripts, or style resources.
- No unexpected horizontal page scroll at target widths.
- Content remains readable at 200% zoom.

## Interaction

- Every visible primary action produces the described state change.
- Current navigation, tabs, menus, dialogs, drawers, and toasts expose their state.
- Loading, empty, success, validation, error, disabled, and permission states are represented where in scope.
- Destructive or irreversible-looking actions require clear confirmation even when mocked.

## Keyboard and accessibility

- Logical tab order and no keyboard trap.
- Every control has a visible focus indicator and an accessible name.
- Dialogs receive initial focus, close with a clear route, and return focus to their trigger.
- Status changes are announced or visible in persistent text.
- Color is not the only carrier of meaning.

## Responsive

- Test at approximately 1440px, 1024px, 768px, and 375px.
- Navigation and dense data transform deliberately instead of merely shrinking.
- Important actions remain reachable without precision pointing.
- Fixed or sticky regions do not cover content.

## Evidence

Save screenshots for the primary desktop and narrow states. Record the browser, viewport, tested path, expected result, actual result, and retest outcome.
