# Native runtime report

**NATIVE_RUNTIME_UNAVAILABLE. No CONFIRMED_RUNTIME findings, screenshots, recordings, live view bounds or frame-time measurements were obtained.**

## What was tested

| Capability | Observation |
|---|---|
| Execution host | Linux x86_64, kernel 6.18.55 |
| Android executables at initial preflight | `adb`, `emulator`, `apkanalyzer`, `aapt/aapt2`: absent |
| Known Android SDK roots | `/opt/android-sdk`, `/opt/android`, `/usr/lib/android-sdk`: absent |
| Hardware virtualization | `/dev/kvm`: absent |
| Physical-device/binder interfaces | `/dev/bus/usb`, `/dev/binder`, `/dev/binderfs`: absent |
| Connected-device plugin | WorkDroid `phone_connected=false`, no session or bridge version |
| App native architecture | Only ARM64 and ARMv7; no x86 native payload |
| Static tools installed during research | Apktool/JADX and Android Build Tools for aapt2/apksigner; no OS/system image |

The concrete blocker is the absence of a compatible Android execution target. An x86 Linux process cannot directly run the ARM Android application and its JNI renderer. A hardware-accelerated emulator was not available. This report does not claim that software emulation is inherently impossible, or that every potential externally provisioned emulator was attempted. No existing compatible runtime was available to validate build 1031, and no translation/signature/licensing bypass was attempted.

Source of these observations: terminal executable/path/device checks plus the connected-device status call, preserved in [verification/runtime-preflight.json](verification/runtime-preflight.json). No APK installation was attempted because there was no target. No owner phone configuration or media was accessed.

## Consequences for interpretation

- All geometry in the atlas is a conditional static calculation in Android layout coordinates. No actual viewport, density, font scale, cutout or bottom-inset number is known for the owner's phone.
- Resource defaults do not prove the owner's saved built-in options, playback state or active theme.
- Timings are nominal/source-derived clocks, not video-measured durations. Coupled list/top/mini-player clocks, frame scheduling and cancellation ordering need original-app observation.
- Font files, custom image matrices and shader sources identify rendering inputs and algorithms. They do not prove final pixel appearance.
- No synthetic/native-look image was generated. Neither V1/V2 output nor marketing screenshots were treated as native evidence.

## Reproducible next capture on an authorized device

Use the unchanged hash-matching APK on an ARM Android test target where installation is supported. Record Android build, app version, `wm size`, `wm density`, font scale, display cutout/insets, system navigation mode, app skin/theme/options and animation-speed preference. With adb available, standard read-only diagnostics include:

```sh
adb shell wm size
adb shell wm density
adb shell settings get system font_scale
adb shell dumpsys package com.maxmpz.audioplayer
adb exec-out screencap -p > full-player.png
adb shell screenrecord --time-limit 25 /sdcard/poweramp-session1.mp4
adb pull /sdcard/poweramp-session1.mp4
```

These are proposed commands, **not commands run this session**. Install/start steps depend on the target and are not claimed here. A normal Android screenshot and screen recording made by the owner are sufficient for the minimum request in [09-GAPS-AND-CAPTURE-REQUEST.md](09-GAPS-AND-CAPTURE-REQUEST.md). For deeper tests, record gesture start/end and cancellation at the same frame rate and obtain hierarchy bounds where custom drawing permits them. Record captures as original build evidence only after provenance and settings are established.
