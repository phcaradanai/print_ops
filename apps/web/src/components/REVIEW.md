# Component review policy

For each molecular migration slice, review the following before moving to the next slice:

- the component owns all styles needed for standalone rendering
- legacy selectors are compatibility-only, not required for the new component
- responsive breakpoints preserve existing behavior unless the change is explicitly approved
- semantic landmarks are not duplicated or rendered empty
- English and Thai copy can wrap without transformation
- tests cover the compatibility facade and direct component use
