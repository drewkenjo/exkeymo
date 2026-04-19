# ExKeyMo (static web)

A pure static port of [exkeymo-server](https://github.com/ris58h/exkeymo-server):
build a signed Android APK with a custom keyboard layout entirely in the
browser. No server, no build step.

The end-user flow is identical to the Node/Java server: fill in the form on
`simple.html` or paste a Key Character Map into `complex.html`, press
**Download**, install the resulting APK, and select `ExKeyMo Layout` in
`Settings → Language & input → Physical keyboard`.

## Layout

```
index.html, simple.html, complex.html, docs.html   # UI (pages match the server 1:1)
common.css, img/                                   # styling & icons
assets/
  app-oneLayout-release-unsigned.apk               # template APK (one layout)
  app-twoLayouts-release-unsigned.apk              # template APK (two layouts)
  cert.pem, key.pem                                # signing cert + key
  kcm/*.kcm                                        # base layouts (same 46 files)
js/
  layouts.js                                       # port of Layouts.java
  zip.js                                           # ZIP reader/writer
  der.js                                           # tiny ASN.1 DER helpers
  signer.js                                        # v1 JAR signer (MANIFEST/SF/RSA)
  builder.js                                       # swap .kcm → re-zip → sign
  app-simple.js, app-complex.js                    # page wire-up
```

## Run locally

Modules and `fetch()` need HTTP, so serve the folder with any static server:

```
python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

## Deploy

Copy the whole folder to any static host (GitHub Pages, S3, Netlify, …).

## Signing

The cert and private key were extracted once from the original `exkeymo.keystore`
and are committed here as PEM so every build shares the same v1 signature (an
installed ExKeyMo APK can be updated in place). This matches the security
posture of the server version, where the same key was already bundled in the
JAR.
