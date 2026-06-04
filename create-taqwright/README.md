# create-taqwright

Scaffold a new [taqwright](https://www.npmjs.com/package/taqwright) project:

```bash
npm init taqwright my-mobile-tests
# or: npm create taqwright@latest my-mobile-tests
```

This is a thin initializer that delegates to `taqwright init` (forwarding all
arguments, e.g. `--platform ios`, `-y`). It exists so the conventional
`npm init <tool>` / `npm create <tool>` bootstrap works for taqwright.

Equivalent if you already have taqwright resolvable:

```bash
npx taqwright init my-mobile-tests
```

After scaffolding:

```bash
npx taqwright install   # auto-install the Android toolchain (zero-touch)
npx taqwright test      # run your tests
```
