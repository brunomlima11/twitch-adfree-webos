# Twitch AdFree

A webOS application that enhances your Twitch viewing experience by blocking ads, automatically claiming channel points, bypassing subscriber-only VOD restrictions, and providing additional features like emote support and improved chat styles.

Based on [youtube-webos](https://github.com/webosbrew/youtube-webos)

> **About this fork** (branch `local-mods`)
>
> This is a personal fork of [adamff-dev/twitch-adfree-webos](https://github.com/adamff-dev/twitch-adfree-webos) with two changes. See [Fork changes](#fork-changes) for details.
>
> 1. The worker ad-block patch is bundled inside the app instead of being downloaded from GitHub Pages at runtime.
> 2. New **Start tab** setting (Home / Following / Browse / Search).


## Features

- **Ad Blocking:** Mute and hide ads automatically
- **Channel Points:** Automatically claims community points during streams
- **Sub-only VODs:** View subscriber-only VODs without a subscription
- **Emote Support:** Integrated support for 7TV and BTTV emotes in chat
- **Performance:** Disable animations to improve performance on lower-end devices
- **Auto-Accept:** Automatically reject cookies and accept mature content banner
- **Chat Overlay:** Display chat as a transparent overlay on top of the video with customizable position, size, and font settings
- **Status Messages:** Optional notifications for blocked ads and claimed channel points
- **Navigation Shortcuts:** Navigate through top navigation using number keys:
  - 1️⃣ — Home
  - 2️⃣ — Following
  - 3️⃣ — Browse
  - 4️⃣ — Search

**Note:** Configuration screen can be opened by pressing 🟩 GREEN button on the remote.

## Fork changes

### 1. Worker patch bundled instead of fetched remotely

Upstream, `src/scripts/twitch_no_sub.js` replaces Twitch's player `Worker` with a blob that runs
`importScripts('https://adamff-dev.github.io/twitch-adfree-webos/src/scripts/patch_amazon_worker.js?v=<version>')`.
That script is downloaded on every app version with no integrity check, and it runs inside the player worker, where it can see and rewrite every playlist request. So whoever controls that GitHub Pages site can change what runs on the TV without a new app release.

In this fork:

- `patch_amazon_worker.js` is imported as a raw string (`import src from './patch_amazon_worker.js?raw'`). It is inlined into the worker blob, so the app makes no remote code request.
- `webpack.config.js` gets a rule `{ resourceQuery: /raw/, type: 'asset/source' }`, and Babel skips `?raw` imports. The worker source stays a plain, untransformed script.
- `useProxy` and `proxyUrl` are written into the blob with `JSON.stringify`. Upstream wraps the URL in single quotes as-is, which breaks if the URL contains a `'`.
- The logic of `patch_amazon_worker.js` is unchanged. At the time of the fork, the copy hosted on GitHub Pages was byte-identical to the one in the repo (sha256 `2ae13106…c518`).

Note: the proxy setting is still on by default, so live playlists still go through `as.luminous.dev`. That service sees your IP and the channel name. You can turn it off in the settings (*Use custom proxy URL for HLS streaming*).

### 2. Start tab setting

New option **"Tab to open when the app starts"**: Home (default), Following, Browse or Search.

- `src/scripts/start_tab.js` runs once per app launch (guarded by a `sessionStorage` flag). It acts only when the app lands on `/`, so launching straight into a channel still works.
- It switches routes with the Next.js client router (`window.next.router.replace`), which needs no page reload. If the router does not appear within 10 s, it falls back to `location.replace`.
- The redirect happens in the userscript, not in `index.js`, because settings are stored in the `lg.tv.twitch.tv` origin's localStorage, which the app's launch page cannot read.
- Routes: Following → `/following`, Browse → `/directory`, Search → `/search`.
- `src/scripts/ui.js`: left/right cycling was hard-wired to the chat position option. It now works for any option that has an `options` list.

**Known limitation:** the tab switch takes about 5–6 s on a webOS 6 TV. Measured on the device, Twitch loads the home page first (DOMContentLoaded at ~4.5 s), and webOS injects the userscript only after that (~5.6 s). The route switch itself happens ~0.2 s later. Removing the delay would require the launch page to know the setting before it navigates.

### Building

Tested with Node 22 and pnpm 8 (`pnpm-lock.yaml` is lockfile v6; pnpm 10 refuses `--frozen-lockfile`):

```sh
corepack prepare pnpm@8.15.9 --activate
pnpm install --frozen-lockfile
pnpm run build && pnpm run package   # -> twitch.adamffdev.v1_<version>_all.ipk
```

The app id is unchanged (`twitch.adamffdev.v1`), so the package installs over the upstream app and keeps your login and settings. A newer upstream version offered by the Homebrew Channel would replace this build.

Sideload on a rooted TV:

```sh
luna-send -w 60000 -i -f luna://com.webos.appInstallService/dev/install \
  '{"id":"com.ares.defaultName","ipkUrl":"/tmp/app.ipk","subscribe":true}'
```

## Screenshots

![Settings Screen](https://raw.githubusercontent.com/adamff-dev/twitch-adfree-webos/refs/heads/main/screenshots/settings.png)

## Contribution

We welcome contributions of any kind — code, documentation, bug reports, or feature suggestions.

If you find this project helpful and want to support its development, consider making a donation.

Your support helps keep the project active and maintained. Thank you! 🙌

<div style="display: flex; gap: 10px;">
  <a target="_blank" href="https://www.buymeacoffee.com/rSiZtB3"><img style="height: 50px" src="https://i.imgur.com/KCk0bxY.png" /></a>
  <a target="_blank" href="https://www.paypal.com/donate/?hosted_button_id=3T9XNAPWW36Z2"><img style="height: 50px" src="https://i.imgur.com/Z3x38ey.png" /></a>
</div>

## Cryptocurrency Donations

You can also support the project with cryptocurrency:

- **Bitcoin:** `bc1qrcdyq2yjgv5alm9kky2e6vyfhnafn3wgd2gjls`
- **Ethereum:** `0x43b9649985d6789452abe23beb1eb610cee88817`
- **Solana:** `4qK7eSQemRj85VY9CQp5XHRwX5fNjoSJ1ou4gmqk6jtM`
- **Litecoin:** `ltc1qp6mya23a73n36dc7r0tfwfphn2v53phmhen99j`

## Installation

- Use [Device Manager app](https://github.com/webosbrew/dev-manager-desktop) - see [Releases](https://github.com/adamff-dev/twitch-adfree-webos/releases) for a
  prebuilt `.ipk` binary file
- Use [webOS TV CLI tools](https://webostv.developer.lge.com/develop/tools/cli-installation) -
  `ares-install twitch...ipk` (for webOS CLI tools configuration see below)

## Configuration

Configuration screen can be opened by pressing 🟩 GREEN button on the remote.

### Autostart

In order to autostart an application the following command needs to be executed
via SSH or Telnet:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"twitch.adamffdev.v1","pigImage":"","mvpdIcon":""}'
```

This will make "Twitch AdFree" display as an eligible input application (next
to HDMI/Live TV, etc...), and, if it was the last selected input, it will be
automatically launched when turning on the TV.

This will also greatly increase startup performance, since it will be runnning
constantly in the background, at the cost of increased idle memory usage.
(so far, relatively unnoticable in normal usage)

In order to disable autostart run this:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/deleteDevice' '{"appId":"twitch.adamffdev.v1"}'
```

## Building

- Clone the repository

```sh
git clone https://github.com/adamff-dev/twitch-adfree-webos.git
```

- Enter the folder and build the App, this will generate a `*.ipk` file.

```sh
cd twitch-adfree

# Install dependencies (need to do this only when updating local repository / package.json is changed)
npm install

npm run build && npm run package
```

## Development TV setup

### Configuring webOS TV CLI tools with Developer Mode App

This is partially based on: https://webostv.developer.lge.com/develop/getting-started/developer-mode-app

- Install Developer Mode app from Content Store
- Enable developer mode, enable keyserver
- Download TV's private key: `http://TV_IP:9991/webos_rsa`
- Configure the device using `ares-setup-device` (`-a` may need to be replaced with `-m` if device named `webos` is already configured)
  - `PASSPHRASE` is the 6-character passphrase printed on screen in developer mode app

```sh
ares-setup-device -a webos -i "username=prisoner" -i "privatekey=/path/to/downloaded/webos_rsa" -i "passphrase=PASSPHRASE" -i "host=TV_IP" -i "port=9922"
```

- Modify device info:

```sh
ares-setup-device --modify emulator --info "host=TV_IP"
```

### Configuring webOS TV CLI tools with Homebrew Channel / root

- Enable sshd in Homebrew Channel app
- Generate ssh key on developer machine (`ssh-keygen`)
- Copy the public key (`id_rsa.pub`) to `/home/root/.ssh/authorized_keys` on TV
- Configure the device using `ares-setup-device` (`-a` may need to be replaced with `-m` if device named `webos` is already configured)

```sh
ares-setup-device -a webos -i "username=root" -i "privatekey=/path/to/id_rsa" -i "passphrase=SSH_KEY_PASSPHRASE" -i "host=TV_IP" -i "port=22"
```

## Installation

```
npm run deploy
```

## Launching

- The app will be available in the TV's app list or launch it using ares-cli.

```sh
npm run launch
```

### Launching directly to a specific channel

You can launch the app and navigate directly to a specific Twitch channel using the `channel` parameter.

#### Using luna-send (SSH/Telnet)

Connect to your TV via SSH or Telnet and run:

```sh
luna-send -n 1 -f luna://com.webos.applicationManager/launch '{"id":"twitch.adamffdev.v1","params":{"channel":"CHANNEL_NAME"}}'
```

#### Using URL parameter (Development)

If you're testing locally or via CLI:

```sh
npm run launch -- -p '{"channel":"CHANNEL_NAME"}'
```

## Build, deploy and launch

The following one-liner is convenient for debugging because it chains together all the essential steps — building, packaging, deploying, and launching — into a single command:

```sh
pnpm run build && pnpm run package && pnpm run deploy && pnpm run launch
```
