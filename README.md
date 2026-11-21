# MeshChat — Offline Messenger

**Connect Without Internet.**

MeshChat is an offline-first Android messaging project. This repository contains a responsive application shell, local IndexedDB storage, ECDH/AES-GCM cryptographic utilities, a Web Bluetooth adapter, PWA support, tests, and an automated Android build workflow.

## Current implementation status

| Feature | Status in this source package |
|---|---|
| Responsive app UI | Implemented |
| Local profile and conversation storage | Implemented |
| Local message history | Implemented |
| Export and clear local data | Implemented |
| ECDH P-256 key agreement utility | Implemented and unit-tested |
| AES-256-GCM encryption utility | Implemented and unit-tested |
| PWA shell caching | Implemented |
| Browser Bluetooth device selection | Experimental; browser support required |
| Native Android BLE plugin | Not yet implemented |
| Reliable two-way peer messaging | Not yet implemented |
| BLE packet fragmentation / retransmission | Not yet implemented |
| Mesh store-and-forward relay | Not yet implemented |
| Group key management and group chat | Not yet implemented |
| Encrypted file transfer | Not yet implemented |
| Background Android discovery | Not yet implemented |

**Important:** The current UI stores outgoing messages locally. It does not yet deliver them to another phone. The peer discovery adapter is experimental and must not be mistaken for a complete native Android BLE implementation. This project intentionally does not display fake delivery receipts.

## Requirements

- Node.js 20+
- npm 10+
- Java 21 for Android builds
- Android SDK API 36 for local Android builds

## Run the web application

```bash
npm install
npm test
npm run dev
```

Open the local Vite URL in a modern browser. Bluetooth APIs generally require a secure context (HTTPS or localhost).

## Android project

The Android shell is generated from the Capacitor configuration:

```bash
npm install
npm run build
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

The generated Android project is intentionally not committed in this starter source archive. GitHub Actions generates it during the Android build.

## GitHub Actions

Push this project to a GitHub repository using the `main` branch. The workflow at `.github/workflows/android-build.yml` runs tests, builds the web app, generates the Android project, and uploads a debug APK artifact.

## Security notes

- ECDH P-256 and AES-256-GCM are implemented using Web Crypto.
- The current demo utility creates ephemeral in-memory key pairs. Production identity persistence, key rotation, peer authentication, replay protection, and secure group key distribution still need implementation and independent review.
- IndexedDB is local browser storage, not encrypted-at-rest storage.
- Do not use this build for sensitive communications until the complete transport and security design has been implemented and audited.

## Architecture

- `src/main.js` — application UI orchestration
- `src/services/database.js` — IndexedDB persistence
- `src/services/crypto.js` — cryptographic primitives
- `src/services/bluetooth.js` — experimental Web Bluetooth adapter
- `src/services/chat.js` — local conversation/message model
- `tests/` — automated unit tests
- `public/` — PWA manifest, service worker, app icon
- `.github/workflows/` — automated Android build

## License

All rights reserved unless a license is added by the repository owner.
