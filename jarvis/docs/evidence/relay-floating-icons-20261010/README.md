# Relay floating header comparison

The before screenshots use source `ef95ae32397e1334bafb26aad23a0e8b5a9ce0ea`,
tree `e221c948059ccad2b50fed8a682bac877bd07d02`. The after screenshots use the
candidate CSS. Every conversation is synthetic; no live owner data was accessed.

Each folder contains mobile 390×844 and desktop 1280×900 captures at scroll zero
and scroll350. The previous gradient visibly darkened and faded the top150px;
the candidate leaves the chat topbar transparent. Only the center icon and
Private/Public label receive small solid backing to stay readable over text.
Existing menu/Work icon surfaces, target sizes, layout, safe-area rules and
interaction behavior are unchanged. Work retains its opaque header.

The regression failed against the baseline's computed gradient and passed after
the change. It checks both private and public chat, absence of gradient/filter/
backdrop blur, unchanged 48px controls and their colors, menu/Escape, Work/Back,
scroll restoration and viewport overflow. Existing modernization browser checks
cover the surrounding navigation, contrast and task editor behavior. Runtime:
Node22.23.3 and Chrome for Testing154.0.8037.97. Physical device safe-area behavior
was not separately tested. The PR description records exact-head hosted results.
