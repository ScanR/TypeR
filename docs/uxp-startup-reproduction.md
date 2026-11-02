# Reproducing the silent UXP startup in real Photoshop

## Result, 2026-11-02

The customer's exact diagnostic build starts successfully on the local Photoshop
27.7.0 / UXP `uxp-9.3.0-uxp` / Windows installation. The first baseline reached
`app.ready` 899 ms after `host.bootstrap`.

The test uses the JavaScript from `Releases/TypeR-DEBUG-Windows.zip`. Its hashes
match the customer's diagnostic:

- `host.js`: `87d59edad3b67285ef42a9c3ac3d817aaaa8d7458d18dc9d1bfb6c78f5b32c8a`
- `web/index.js`: `4ceadfcf0112252e12d82b2d37b8b11dca524be7b7832dadba50a83b89d6ee91`

Only plugin identity and label change in the baseline, allowing it to coexist
with installed TypeR and use separate storage. This is a Developer installation;
the customer used External installation. Local UI locale is `en_GB`, the customer's
is `en_AE`. The local WebView user agent reports Edge 156; the customer's runtime
version is unknown. Neither the customer's preferences nor their installation
modifications are reproduced.

| Controlled scenario | Real UXP result | Matches the customer's silent journal? |
| --- | --- | --- |
| Original package | `loadstart`, bridge, init, `app.ready` | No |
| WebView height forced to zero | Still reaches `app.ready` | No |
| Local HTML file missing | `loadstart`, then `loaderror` code 0 | No |
| Local rendering permission disabled | `loaderror` code 14 | No |
| Application JavaScript file missing | Inline HTML script, script error, `loadstop`; no app readiness | No |
| WebView hidden with CSS `display: none !important` | No load events, bridge messages or HTML script for 24 seconds | Yes, through the customer's 23-second export window |

Removing the injected hiding rule lets the same WebView load and reach
`app.ready` without restarting Photoshop or changing WebView2. A zero-height
WebView alone does **not** behave like a hidden WebView here. Its inline
`style.display` can say `block` while an `!important` rule keeps it hidden;
recording just inline styles is insufficient.

**This reproduces the symptom with a deliberate visibility fault, not the
customer's root cause.** There is no evidence that this CSS rule exists in their
installation. A missing or damaged runtime remains untested. Do not infer that a
cracked installation is necessarily the cause, or that installing a runtime will
necessarily fix it. No production fix is justified by this experiment alone.

## Run the native integration probe

Requires Windows, running Photoshop 27.7.0 and Adobe developer mode already
enabled. The script does not enable developer mode, install over TypeR, edit
documents, change runtime files, or drive the application UI with mouse/keyboard
automation. Adobe's tooling loads a separate temporary panel and the script uses
its JavaScript debugger protocol. Each successful run unloads its test plugin.

Install the Adobe CLI into the ignored local test directory. CLI 1.2.0 omits its
installer's `tar` dependency, so install it explicitly and extract the shipped
native helper:

```powershell
npm install --prefix .update-test/uxp-tools --no-audit --no-fund --ignore-scripts @adobe/uxp-devtools-cli@1.2.0 tar@6.2.1
node .update-test/uxp-tools/node_modules/@adobe/uxp-devtools-helper/scripts/devtools_setup.js
.\.update-test\uxp-tools\node_modules\.bin\uxp.cmd service start
```

Leave the service running. In another terminal at the repository root:

```powershell
# Exact original build, no injected fault
node scripts/reproUxpStartup.js

# Silent WebView, followed by restoring visibility and checking app.ready
node scripts/reproUxpStartup.js Releases/TypeR-DEBUG-Windows.zip hidden hidden

# Other controls, run sequentially
node scripts/reproUxpStartup.js Releases/TypeR-DEBUG-Windows.zip zero-height zero-height
node scripts/reproUxpStartup.js Releases/TypeR-DEBUG-Windows.zip missing-page missing-page
node scripts/reproUxpStartup.js Releases/TypeR-DEBUG-Windows.zip missing-bundle missing-bundle
node scripts/reproUxpStartup.js Releases/TypeR-DEBUG-Windows.zip deny-local deny-local
```

Each run takes about 25 seconds to cover the customer's 23-second capture window,
then checks the expected result. It saves a JSON report, including the real
Photoshop diagnostic journal, to `.update-test/uxp-repro/<name>-result.json`.
The hidden test preserves both the silent journal and the recovered journal.
Failures return a nonzero exit code. Reports explicitly identify injected faults.
Stop the CLI service with Ctrl+C after testing.

If a run is interrupted before unloading, unload only its isolated plugin:

```powershell
Set-Location .update-test/uxp-repro/hidden
..\..\uxp-tools\node_modules\.bin\uxp.cmd plugin unload --apps PS@27.7.0
```

For a future customer report, capture native panel create/show/hide events,
WebView and ancestor visibility/dimensions before the timeout hides the view,
and the actual WebView2 process version. The current report cannot distinguish a
hidden renderer from an engine that never starts.

Adobe tooling reference: [UXP developer CLI](https://github.com/adobe-uxp/devtools-cli/tree/main/packages/uxp-devtools-cli).
