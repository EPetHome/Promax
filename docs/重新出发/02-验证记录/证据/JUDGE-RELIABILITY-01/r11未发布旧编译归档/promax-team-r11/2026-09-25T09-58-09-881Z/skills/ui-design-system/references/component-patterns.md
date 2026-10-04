# Component coverage

Specify only components used by the product, but cover each one completely.

| Component | Minimum states and rules |
| --- | --- |
| Button | primary, secondary, quiet, destructive; hover, focus-visible, active, disabled, busy |
| Input / textarea | label, hint, placeholder, value, focus, disabled, error, required |
| Select / combobox | closed, open, selected, empty, disabled, keyboard navigation |
| Navigation item | default, hover, current, nested, collapsed |
| Card / panel | hierarchy, title, metadata, actions, empty state |
| Table | header, row hover/focus, selected, empty, loading, overflow, sortable state |
| Tabs | selected, unselected, focus, overflow behavior, matching panel relationship |
| Status chip | text label plus color or icon; consistent severity mapping |
| Dialog / drawer | title, description, initial focus, focus containment, close path, return focus |
| Toast / inline notice | severity, concise action, timeout behavior, screen-reader announcement |

Avoid clickable `div` or `span` elements. Icon-only buttons need an accessible name and a tooltip where the meaning is not obvious.
