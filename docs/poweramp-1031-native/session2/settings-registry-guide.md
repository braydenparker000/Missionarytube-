# Reading the Settings registry

The registry separates declaration discovery from proved behavior. Start at `settings-registry.json` for a literal native key; follow `control_occurrences` into `settings-controls.json`, array references into `settings-choice-arrays.json`, and typed `registration_ids` into `preference-registrations.json`. Explicit deep-trace references lead to `setting-deep-traces.json` and the evidence ledger. Page IDs join the screen registry and helper table. Multiple controls can share a key but differ by page, qualifier, profile or visibility.

The inventory contains290 unique XML value-control keys, not452 settings. The452 count also includes navigation, actions and information. ProgressPreference rows are action-capable and can display progress; their class name must not turn scan/update commands into read-only status. All648 merged declarations retain each source qualifier/location, including API-dependent title metadata. Labels are base English resource interpretations; localization and helper-replaced labels remain separate.

Values are typed. Boolean switches use booleans; TagList/NumberList values come from their actual arrays, not display positions. Seekbar declarations retain min/max/step/floatScale and array references. The helper can replace arrays or control availability, so declarations alone are not a guarantee of final choices. Missing range metadata is unresolved or supplied dynamically, never automatically an unbounded input. `settings-default-differences.json` preserves raw comparison results; the persistence map explains real differences, float display scaling and null/string fallback.

Registration rows retain constructor values and their exact expressions. They also expose candidate lexical field references, deliberately labeled as candidates. These references do not establish read/write direction, default precedence, dependency or application timing. A null apply contract or empty deep-trace list is an honest unfinished effect trace, not evidence that changing the setting does nothing.

All ten XML value-control keys lacking a direct registration match have identified special bindings: `_autosave`, the four tone knobs, `enable_vis`, `float`, `output_api`, `usb_activity`, and `load_user_so`. They use DSP/model aliases, scoped output properties, component enabled-state or marker-file persistence. This is why unmatched keys were investigated instead of discarded.

Three major configuration surfaces live outside this XML-key cohort:

- `skin-settings-registry.json`:31 keyed Light/Black schema controls,17 distinct keys and74 choice entries. Resource-ID choices, shared controls, ordered application and skin-specific storage are specified in the resolver and persistence references.
- `list-options-registry.json`: dynamically constructed controls depend on provider interfaces. It includes category/home, search categories, sorting/reversal, limits, duration, per-list memory, zoom, titles and compact header. Rows explicitly distinguish shared mechanisms from named provider chains.
- `widget-settings.json`:37 interactive option IDs, four tabs, per-size ranges and qualified values. These use the widget-ID style model, with a documented global artwork-animation exception.

Editable sub-art button arrays and layout controls are custom typed state, covered by the persistence map and style reference. EQ band/card/preset editing is stateful DSP/list UI, covered by the screen, interaction and rendering contracts rather than incorrectly flattened into the global Settings registry. Audio settings stop at their documented configuration interface where native DSP behavior is outside scope.

Use `coverage-metrics.json` for finite denominators and `unresolved-questions.json` for missing semantics. Do not derive an overall completeness percentage from overlapping keys, controls, categories, profiles, presets and dynamic instances.
