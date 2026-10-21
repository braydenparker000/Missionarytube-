#!/usr/bin/env python3
"""Write the concise integration report from validated research metrics."""
import json,os,collections
from pathlib import Path
ROOT=Path(os.environ.get('POWERAMP_RESEARCH_ROOT','/workspace/work/poweramp'));D=ROOT/'session2/drafts'
m=json.loads((D/'coverage-metrics.json').read_text());s=json.loads((D/'screen-registry.json').read_text());depth=collections.Counter(x['depth'] for x in s['screens'])
counts=m['session2_evidence_statuses'];sources=m['cited_private_source_files'];fixture=m['configuration_fixtures']
(D/'README.md').write_text(f'''# Poweramp build 1031 — Session 2

Session 2 reconstructs the configurable native UI and Settings system from the original APK. It continues [Session 1](../README.md) without modifying that research or any player implementation. **Ready for Session 3 architecture and bounded implementation experiments; not ready to claim complete native parity.** No Android runtime was available and no result is runtime-confirmed.

The investigation adds {m['session2_evidence_records']} evidence records: {counts['CONFIRMED_STATIC']} confirmed static, {counts['CONDITIONAL_INFERENCE']} conditional, {counts['OPEN']} open and {counts['BLOCKED']} blocked. The source index hashes {sources} private evidence files. Session 1's151 records remain unchanged. This reference contains original analysis, bounded identifiers/values and reproducible research scripts; no APK, decompiled source dump, proprietary artwork/font or native library payload is published.

| Deliverable | Read first | Structured companion |
| --- | --- | --- |
| Screen/component atlas and navigation | [Screen atlas](screen-atlas.md) | [Screen registry](screen-registry.json), [navigation graph](navigation-graph.json) |
| Settings control/storage/default model | [Settings system](settings-system.md), [registry guide](settings-registry-guide.md) | [Settings registry](settings-registry.json), [controls](settings-controls.json), [choices](settings-choice-arrays.json), [registrations](preference-registrations.json), [persistence map](settings-persistence-map.json) |
| Selected complete effect chains | [Settings effects](settings-effects.md) | [78 traces](setting-deep-traces.json) |
| Dynamic library and widget configuration | [List options](list-options.md), [widget settings](widget-settings.md) | [List registry](list-options-registry.json), [widget registry](widget-settings.json) |
| Effective styles, qualifiers and scenes | [Resolver specification](style-resolution.md) | [Skin registry](skin-settings-registry.json), [{fixture} fixtures](configuration-fixtures.json) |
| App-wide interaction contracts | [Interactions](interactions.md) | [Event/state contracts](interaction-contracts.json) |
| Custom secondary rendering | [Rendering components](rendering-components.md) | [23 components](rendering-components.json) |
| Evidence and known limits | [Coverage report](coverage-report.md), [Session 1 qualifications](session1-qualifications.md) | [Evidence ledger](evidence-ledger.jsonl), [source index](source-citation-index.json), [unresolved questions](unresolved-questions.json) |
| Next session and recovery | [Session 3 entry](session3-entry.md), [continuation checkpoint](continuation-checkpoint.md) | [Validation results](validation-results.json), [coverage metrics](coverage-metrics.json) |

Research branch: `research/poweramp-1031-ui-settings-session2`, based on Session 1 commit `0f4276fe556560c027497a70b76b0bd2bf3a361f`. The branch publication receipt records the exact immutable research snapshot after delivery. No merge or deployment is part of this work.
''')
(D/'coverage-report.md').write_text(f'''# Coverage and readiness

The application-wide inventory is meaningful and source-backed, with complete denominators for the manifest, library catalog/router and Settings XML/helper factory. It is not an exhaustive reconstruction of every conditional state or every preference effect. Counts below describe different, overlapping sets and must not be summed into a fictional total number of screens or settings.

| Coverage set | Result | Depth and limits |
| --- | ---: | --- |
| Manifest | 40 activities;23 aliases | All enumerated, including nonvisual bridges and SDK classes; some application-level entry guards remain open. |
| Library catalog/router | 20 category variants;16 route keys plus main selector | All finite catalog/factory entries mapped; data-instance and history cross-products are not exhausted. |
| Screen registry | {len(s['screens'])} typed entries | Includes overlays, templates, modes, external surfaces and nonvisual components, not144 independent screens. {depth['routed_and_constructed']} have routed-and-constructed depth;45 are factory-proven Settings pages. No count implies every control/pixel/animation on that entry is closed. |
| Navigation | {m['navigation_nodes']} nodes;{m['navigation_edges']} edges | Typed routes, guards, Back and construction relationships; endpoints validated. |
| Settings XML | 76 files;45 resource names;1119 control occurrences |648 distinct declarations after equivalent qualifier merging; all root PreferenceScreen resources parsed and matched to helper pages. |
| XML keyed controls |452 distinct keys |290 are value controls; other keys name actions/navigation/status/containers. This is not452 user settings. |
| Typed registrations |418 literal-key registrations;275 global adapter members |Nine selected stores/six common factories; custom/no-key storage separately documented. Candidate lexical references are discovery, not proven consumers. |
| Selected non-skin effect chains |78 keys across18 pages |68 reach control→storage→consumer/native-interface;10 have explicitly narrower depth. This is68/290 (23.4%) at that strict depth within the XML value-control cohort; additional skin/global-style/rendering traces are not silently added to that numerator. |
| Built-in skin schema |31 keyed controls across Light/Black;17 distinct keys;74 selectable choice entries |All keyed declarations/options preserved; shared persistence/overlay mechanism and representative outcomes traced. Same key can have skin-specific choices. |
| Dynamic List Options |9 control families;79 relevant registration slots discovered |Shared construction/listener mechanism and named All Songs consumers deeply traced. Not79 separately completed provider chains. |
| Widgets |37 option IDs across4 tabs and4 size activities |Control/model/store/preview/completion chain, ranges, flags and API gates traced; preset pixels/host behavior remain open. |
| Style fixtures |{fixture} |72 core configuration combinations plus each built-in choice, globals, qualifiers, typography, sub-art and6 migration-derived cases. One fixture remains inferred; no fixture is an observed screenshot. |
| Interaction contracts |32 evidence records |Separate selection/reorder/search/knob/dialog/popup/Back owners; partial grouped geometry and race coverage retained. |
| Rendering reference |23 components |Construction, data and drawing contracts; native numerical/shader/platform boundaries explicitly limited. |
| New evidence |{m['session2_evidence_records']} records;{sources} source files |{counts['CONFIRMED_STATIC']} static, {counts['CONDITIONAL_INFERENCE']} conditional, {counts['OPEN']} open, {counts['BLOCKED']} blocked; zero runtime. |

The most consequential recovery is the default/value pipeline: XML declaration, typed constructor, saved value, fresh migration, Reset action and effective runtime selection are six distinct phases. This explains actual default differences and the fresh library-home qualification. Persistence is scoped rather than one global map; no-op global observers require explicit effect listeners. Built-in skin selection stores resource identities and applies ordered overlays, including narrow global reapplication. Dynamic list and widget configuration have their own controllers and storage.

The new graphics/layout work closes symbolic FastTextView single-line baselines, custom padding removal and nonstandard measurement, selected FastLayout constraints, sub-art slot ordering, EQ curve/texture separation and color interpolation ownership. It preserves unresolved final layout branches and platform metrics. The new input work proves several non-rollback CANCEL paths, distinct Navbar More/dialog thresholds and delayed reorder cleanup; it does not collapse those into one timeline.

Validation checks JSON shapes and unique IDs, source existence and line bounds, complete XML/helper set equality, navigation endpoints, fixture catalog/evidence references, typed aliases/default invariants and model calculations. Independent review corrected ProgressPreference classification. Research scripts compile. App tests/builds were not run because application files and behavior were not changed. Source/hash checks prove the cited reconstruction, not native runtime fidelity.

The main unresolved areas are all remaining Settings consumers, hardware output initialization/capabilities, grouped reorder/provider/search races, recursive layout and multiline text, native graphics precision, notification/widget host states and some conditional entry guards. [The prioritized register](unresolved-questions.json) names concrete next methods and why each matters. Runtime absence was briefly rechecked; no emulator, adb/KVM or connected WorkDroid phone was available. Static investigation continued.

**Session 3 may choose an architecture and begin bounded experiments using these contracts. Complete configurable parity and production readiness are not established.** No owner's saved configuration or settings export is a prerequisite.
''')
print(json.dumps({'report_written':True,'evidence':m['session2_evidence_records'],'source_files':sources,'fixtures':fixture}))
