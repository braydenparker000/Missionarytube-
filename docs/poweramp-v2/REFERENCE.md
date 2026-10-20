# Poweramp 1031 focused reference investigation

APK: 23,936,965 bytes, SHA-256 `27cfde3fc8e55b2effffe88c7e80ec3a1b1f69ec37a09ef86d9a34aafe8ebb9e`.
All decoded resources, DEX-derived Java/smali and binaries stayed in private scratch outside the repository. None is an application/build input.

## Tooling proof

- OpenJDK 17.0.20; Apktool 3.0.3; JADX 1.5.6. Official release downloads succeeded through ordinary HTTPS.
- Apktool JAR SHA-256 `dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423`; JADX ZIP SHA-256 `545ea2be9c242511bc145755cf4bda2485ade42966e096f8b4d3da2a230e8974`. Each matched its official GitHub release asset digest.
- `java -jar tools/apktool_3.0.3.jar d ../upload/Poweramp-build-1031-uni.apk -o decoded` succeeded, including both DEX smali trees and decoded resources.
- `tools/jadx/bin/jadx -r --single-class <class> --single-class-output <name>.java ../upload/Poweramp-build-1031-uni.apk` generated focused Java for TopNavSceneFastLayout, its controller i22, base SceneFastLayout, Waveseek, PowerList and AABounds. The waveform base m92 yielded a Java file but reported one decompilation error. Decompiled control flow is therefore not an unquestioned specification.
- No adb, Android emulator or authorized original-app runtime target was present. No original-app screenshots, frame timings or owner configuration were captured. Ghidra was unnecessary for this UI slice and was not installed.
- Decoded manifest metadata reports versionName build-1031-uni, versionCode 1031009, min SDK 21, target SDK 36. ZIP confirms two DEX files and ARM64/ARMv7 Poweramp core and FFmpeg libraries.

## Scene and style precedence

The `layout-sw2dp/activity_main.xml` scene hierarchy uses TopNavSceneFastLayout with a ListWidget, AABounds, waveform/control layout, configurable sub-art action layout, navbar bounds, navigation container and status/navigation inset views. Scene parameters govern visibility, alpha and measurement. Named declarations are not necessarily the active style: TopPoweruiStyles maps `TopAABounds` to **TopAABounds2**, which inherits list geometry and delegates measurement to a shared substyle object. The similarly named simple TopAABounds is not sufficient to establish effective stock geometry.

Stock and owner settings must remain separate. Built-in alternate layout, More Buttons, Less Rounding, font, artwork, navbar and other overlaps exist. The owner has supplied no settings export or matched screenshot. The first browser interpretation is explicitly provisional where resource layering cannot establish the final visible state.

## High-value geometry

- Standard artwork scene uses 8dp margins on all sides. Its normal scene scale is 0.975, with 1.0 for the playing scene. Core radius is 18.75dp; Less Rounding changes it to 12dp. The active bounds center horizontally, respect system-bar insets, match the AA substyle and reserve a base 200dp below artwork. Small/landscape/large configurations may differ.
- The standard title and artist/line2 are **over the lower artwork**, each with a translucent rounded background, inverse text, and a left offset of 18dp. Title is 16.5dp bold, line2 14.5dp; core scene scales are 1. Title has 1dp margin above line2; line2 anchors above rating with an 18dp bottom margin. Core title padding is 12dp horizontal and 8dp vertical. These are resource facts, not screenshot measurements.
- Sub-art configurable actions attach below artwork, with 8dp outer horizontal margins. Standard waveform attaches between that row and navbar bounds, with 16dp top padding and 24dp bottom margin. Playback control and time labels overlay its center rather than creating an unrelated transport row.
- Standard waveform defines 100 bars, automatic bar width, 1.25dp spacing, 10dp minimum height, 2dp divisor, 50% cursor position and fading side bars. Its base height cap is 128dp; a 360dp-smallest-width/730dp-height portrait configuration raises that to 164dp. It is a moving centered waveform, not merely a fixed track-wide progress bar. A browser timeline should not be labeled an exact waveform replica.
- Standard play cap: 64dp base, 82dp for 360×610 portrait qualifiers, 90dp for 360×730. Pause is a separate 28dp base view with 1.75 scale. These can be replaced by More Buttons and other variants.
- Bottom nav has exactly four principal actions: Library, Equalizer, Search and Menu. Base nav height40dp/icons28dp; 360×610 portrait48/32; 360×730 portrait52/36. Default horizontal margin8dp, bottom4dp, rounded corners22dp. Nav list/miniplayer and optional seekbar are distinct rows.
- Mini-player: artwork28dp, margin-left10dp and radius8dp; title/line2; an independently clickable play/pause target60×48dp with right margin3dp. Title/line2 leave64dp right space for this target. Navbar list height follows nav-height, with −4dp bottom margin. Optional navbar seekbar is32dp tall with8dp vertical padding. It is present only in 3-line navbar scenes; do not assume the owner has enabled it.
- Default library list item96dp, compact56.36sp, zoomed137dp; text-category item64dp. A small track-row implementation is a compact variant approximation until the owner list density is established.

## Dark style facts

`Base_ActivityTheme_Black`: main background#222, nav background#181818, title/icon primary#fff, primary accent#fff, secondary nav icon#999, title-overlay background#c0000000, metadata#999. Navbar selector uses primary color when active/pressed and secondary otherwise. Artwork backdrop is dynamic, so #222 is not an assertion that every runtime pixel is flat charcoal. No blue accent is established by stock black resources; a configurable owner accent is a separate uncertainty.

## Motion and input

There are several timing layers, not one universal duration. Root TopContainer defines generic150ms, main-enter500, main-exit250, play-state320, forced250. The list substyle separately defines page250, AA-position550, AA-settle650, library↔art250, search→art250, art→search150. TopListWidget also carries preferredAAAnimTime350. Controller i22 calls AnimTimeHelper for some paths and can add a first-transition delay. These values **do not by themselves establish actual elapsed expansion/collapse time**.

TopNavSceneFastLayout delegates navigation to i22 and forwards intercept cancellation. Base SceneFastLayout delegates scene machinery to do1. PowerList delegates intercept and touch handling to a gesture object; its intercept returns false/true/super based on that object. Waveseek inherits input from obfuscated m92. The waveform has separate pressed animation and input handler. JADX warned about m92 onTouchEvent reconstruction, so exact cancel/release/threshold semantics require smali tracing or runtime observation before claiming native equivalence.

The XML directly wires long press on the main play/pause controls to Stop, distinct from ordinary toggle. This is a recoverable behavior worth implementing with explicit pause intent. Main art swipe thresholds and mini-player expansion gesture arbitration remain unknown. Do not copy arbitrary browser/Android thresholds and call them recovered.

## Immediate capture request when useful

One stock-player screenshot and one library screenshot on the A15 at the current settings, then a short player↔library/mini-player recording (normal tap, slow drag reversed before release, cancel, horizontal artwork swipe). Include whether More Buttons, Alternate Layout, optional navbar seekbar and enlarged artwork/text are enabled. This is a calibration gate, not a blocker for first implementation.

## Bytecode cross-checks completed

`AnimTimeHelper.calcAnimTime(float, boolean)` was decompiled and cross-checked in its smali. Some configuration paths multiply durations by0.6; a disabled-animation path returns0.001s depending on the boolean argument. Thus declared timing constants cannot be treated as final elapsed times even before runtime interruptions. No label was assigned to the obfuscated configuration value without tracing the preference declaration.

The disputed waveform `m92.onTouchEvent` was inspected in smali at method source lines5093 onward (bytecode-local debug lines13–34,86–135). DOWN inside padded bounds establishes ownership when enabled. MOVE without ownership exits; UP and CANCEL without ownership exit; owned UP/CANCEL clear ownership. An optional touch handler receives the event; pressed cleanup on release/cancel depends on whether its scrolling/settling object remains active. This corrects the visibly duplicated/contradictory JADX rendering. It establishes the ownership gate but does not settle exact waveform seek or fling semantics.
