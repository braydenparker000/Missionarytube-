# Session 1 qualifications and preserved findings

Session 1 at commit `0f4276fe556560c027497a70b76b0bd2bf3a361f` remains unchanged. Its 151 records retain their original confidence classifications. Session 2 adds evidence rather than turning static claims into runtime observations.

| Earlier boundary | Session 2 qualification | Evidence |
| --- | --- | --- |
| Registered library home0 interpreted as the default All Songs destination | Registration is0, but fresh-install migration runs with previous build-1 and sets home-1, the category home. Explicit selection0 still means All Songs. The Session 1 transition to that destination remains valid. | PREF-009/010, LIST-001, screen graph |
| Skin declaration defaults used as a starting configuration | Fresh initialization applies ordered migrations. Both built-ins get More Buttons=true and BoldFont; a device predicate can choose Alternative/Full Cover and navbar changes. Declaration, constructor, fresh and reset values are distinct. | PREF-011/018–023; style fixtures |
| Resource/style selection versus final pixels | Session 2 resolves many more overlays and qualifiers, but the 273 fixtures are static-model outcomes. They do not add observed native pixels, glyph metrics or gesture recordings. | STYLE ledger; fixture contract |
| Shared gesture machinery | New owners have distinct contracts: dialog release thresholds, round/linear knobs, reorder and nested scrolling cannot be assigned the main-player transition timeline. | INPUT ledger |
| Owner-specific capture/settings suggestion in the original continuation text | The current user explicitly defines the target as the entire configurable application and prohibits requesting a settings export. That instruction supersedes the earlier owner-configuration prerequisite. Native captures can validate chosen configurations later. | Session 2 user request; session3-entry.md |

The actual AAItemView/ListWidget/AABounds hierarchy, effective TopAABounds2 mapping, independent top/list/navbar animation systems, programmatic versus gesture transitions, waveform geometry/input, artwork/text/shader/backdrop ownership and Session 1 smali corrections are preserved. Session 2's new malformed-JADX corrections are recorded against their own methods; no blanket assumption that Java output is correct was introduced.

Evidence shorthand above uses the full prefix `PA1031-S2-`. Findings with incomplete static paths stay conditional/open; lack of Android execution stays blocked. Source enumeration and fixture computation are not runtime confirmation.
