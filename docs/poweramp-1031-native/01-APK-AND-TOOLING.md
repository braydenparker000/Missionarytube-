# APK identity, tooling and reproducibility

Source: the user-supplied `POWERAMP_1031_SESSION1_CODEX_BUNDLE.zip`. `START_HERE.txt` and the complete Session 1 handoff were read before source investigation. The ZIP contains those two text files and one APK; it contains no native runtime captures or settings export.

| Property | Verified result |
|---|---|
| APK | `Poweramp-build-1031-uni.apk` |
| Bytes | 23,936,965 |
| SHA-256 | `27cfde3fc8e55b2effffe88c7e80ec3a1b1f69ec37a09ef86d9a34aafe8ebb9e` |
| Package / version | `com.maxmpz.audioplayer`, `build-1031-uni`, code `1031009` |
| SDK | minimum 21; target/compile 36 |
| Resource package | application ID `0x7f`; 14,258 public resource identifiers |
| DEX | `classes.dex`, `classes2.dex`; 7,687 decoded smali class files |
| Native ABI | `arm64-v8a`, `armeabi-v7a` only |
| Native libraries in each ABI | `libpowerampcore.so`, `libffmpeg_neon.so` |
| Integrity | entire ZIP CRC test passes; expected APK hash matches |
| Signature | apksigner verification passes; v1 and v2 true; one RSA-2048 signer |
| Signer certificate SHA-256 | `f6355bdd54f8cedd64f9f6e9813bb0b55a2ac24b82b461e99f86db336ee64255` |

Signature verification confirms the supplied package's signing integrity; this is not an independent attestation of the publisher's identity. The tool emitted JAR `META-INF` coverage warnings while v2 verification passed. The unmodified full output is in [verification/apksigner-verify.txt](verification/apksigner-verify.txt). Nothing was stripped, patched or re-signed.

## Toolchain actually used

| Tool | Version | Purpose |
|---|---|---|
| OpenJDK | 21.0.12.1 | Run official Java tools |
| Apktool | 2.11.1 | Resource XML and both DEX smali trees |
| JADX | 1.5.3 | Java-like navigation and cross-references; names preserved |
| Android Build Tools | 35.0.0 | Independent manifest/configuration and signature inspection |
| aapt2 | 2.19-11948202 | Binary resource configuration/badging |
| apksigner | 0.9 | Signature verification |
| pyelftools | 0.32 | ELF segments, relocations and JNI method-table mapping |
| Capstone | 5.0.6 | Narrow ARM64 UI-rendering disassembly |
| Pillow | 12.3.0, preinstalled | Source-resource dimensions and pixel histograms (not screenshots) |
| Python / ripgrep | local execution tools | Inventory, original calculation checks and artifact validation |

Official HTTPS acquisition URLs and the **locally computed**, reproducible tool SHA-256 digests are in [12-APK-RESOURCE-INVENTORY.json](12-APK-RESOURCE-INVENTORY.json). Digests were not independently compared to a separate signed tool-release manifest. Build Tools were extracted only for the needed static tools. Read-only repository context was verified against remote `main`, commit `4fd9547d37d5845fbafb3f0edad53b6150a8cedd`; local branch was `work`, clean. No application files were used as design evidence.

The native Python packages were installed into private scratch, then independently compared byte-for-byte with official PyPI wheels whose hashes match PyPI metadata. [verification/native-python-provenance.json](verification/native-python-provenance.json) records acquisition, digests and the 112 matching package files. JNI mapping was independently rerun and matched the earlier metadata output. No native code was executed.

## Preflight and limitations

- Entire APK read successfully; Apktool decoded `res/layout-sw2dp/activity_main.xml`, values/qualifiers and both smali trees.
- Representative class `com.maxmpz.audioplayer.widget.TopNavSceneFastLayout` decompiled successfully; constructor and `onApplyWindowInsets` traversed in both Java and smali. Its delegates are `i22`, `j22` and `do1`.
- JADX finished all 4,060 processing units with **nine reported errors**. Five output files carry explicit `JADX ERROR` comments (inventory lists them). Other methods silently contain malformed reconstructed branches. Critical waveform, scene, duration and geometry branches were therefore checked in smali; an apparently successful Java decompile is not treated as proof.
- Initial download attempt could not reach the environment proxy from the default command sandbox. The supported network-enabled command permission worked, through the inherited proxy and TLS trust. No denied destination or direct-network workaround was used.
- JADX initially attempted its default read-only home configuration location. Its supported `JADX_CONFIG_DIR`, `JADX_CACHE_DIR` and `JADX_TMP_DIR` were redirected to research scratch; the temp directory had to exist first. The home directory was not changed.
- Native runtime capability failed preflight; see [07-RUNTIME-OBSERVATIONS.md](07-RUNTIME-OBSERVATIONS.md). Static Build Tools installation does not create an Android runtime.

## Inventory boundaries

The package contains 168 decoded resource type/configuration directories and 134 configurations reported by aapt2, including localization and third-party-library resources. Only one `activity_main` file is present: `layout-sw2dp/activity_main.xml`. Built-in appearance variation is predominantly theme/style/resource qualification and runtime scene construction, not a family of independent full-player activity XMLs. See the atlas for applicable selectors.

The machine-readable inventory includes configuration directories, compiled configurations, font identifiers, DEX/native-library byte counts and hashes. It does **not** include asset payloads. Decompiled code, DEX, APK, native libraries and proprietary fonts/art remain outside the repository and outside this deliverable package.

## Exact reconstruction commands

Run from a private scratch directory containing the original APK and downloaded tools. These commands reproduce citation line locations with the recorded versions:

```sh
sha256sum Poweramp-build-1031-uni.apk
java -jar tools/apktool_2.11.1.jar d -f -p tools/framework -o decoded Poweramp-build-1031-uni.apk
mkdir -p tools/jadx-config tools/jadx-cache tools/jadx-tmp
JADX_CONFIG_DIR="$PWD/tools/jadx-config" JADX_CACHE_DIR="$PWD/tools/jadx-cache" JADX_TMP_DIR="$PWD/tools/jadx-tmp" JAVA_OPTS='-Xmx3g' tools/jadx-1.5.3/bin/jadx -r -j 3 --rename-flags none --no-inline-methods --no-inline-anonymous --show-bad-code -d jadx Poweramp-build-1031-uni.apk
java -jar tools/build-tools/android-15/lib/apksigner.jar verify --verbose --print-certs Poweramp-build-1031-uni.apk
tools/build-tools/android-15/aapt2 dump badging Poweramp-build-1031-uni.apk
tools/build-tools/android-15/aapt2 dump configurations Poweramp-build-1031-uni.apk
```

A nonzero JADX result is expected from this package; do not discard generated source. Preserve Unicode identifiers (`ׅ`, Cyrillic versus Latin lookalikes). Smali method signature plus labels is the stable control-flow reference; source line numbers are convenience locations tied to this toolchain. `decoded/` and `jadx/` citations resolve relative to the private reconstruction root, **not** to a published source tree.
