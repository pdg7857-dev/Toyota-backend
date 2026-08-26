# Client files go here (never committed)

This pipeline cannot obtain the client — network access reaches package
registries only. Supply these files yourself:

```
reference/client/
  base.apk                     # required
  split_config.arm64_v8a.apk   # if the install uses split APKs
  split_config.xxhdpi.apk      # if the install uses split APKs
  main.<version>.obb           # if an OBB expansion exists
```

## Getting them off an Android device

```bash
adb shell pm path com.<package>      # lists every APK in the install
adb pull /data/app/.../base.apk reference/client/
```

`pm path` printing more than one line means the install is split — pull all
of them. If only `base.apk` is supplied and the game turns out to use split
APKs or Addressables, Stage 0 says so, because the assets may live in a file
that was not provided.

An iOS `.ipa` also works but is more awkward; prefer Android.

Everything in this directory is gitignored. Nothing here is uploaded,
published, or sent anywhere — the whole pipeline runs locally.
