# Stablecoin Wallet — React Native App

Premium cross-chain stablecoin wallet built with Expo.

## Stack
- React Native + Expo SDK 51
- Redux Toolkit — state management
- React Navigation — routing
- Expo SecureStore — encrypted token storage
- Expo Camera — QR scanner
- Expo LocalAuthentication — biometrics
- React Native Reanimated — animations
- React Native QRCode SVG — QR generation

## Screens
- Login / Register
- Dashboard — portfolio, balances, recent activity
- Send — token transfers across all chains
- Receive — QR code + address display
- Bridge — cross-chain transfers
- Scan — QR code scanner for payments
- Create Wallet — new wallet + seed backup
- Profile — settings, KYC, security
- KYC — identity verification

## Setup

```bash
cd apps/mobile
pnpm install
```

Set your API URL in `.env`:
```
EXPO_PUBLIC_API_URL=http://YOUR_MACHINE_IP:3001
```

For Android emulator use: `http://10.0.2.2:3001`
For physical device use your machine's local IP: `http://192.168.x.x:3001`

## Run

```bash
# Start Expo dev server
pnpm start

# Android
pnpm android

# iOS (Mac only)
pnpm ios
```

## Build for production

```bash
# Install EAS CLI
pnpm add -g eas-cli

# Configure
eas build:configure

# Build APK (Android)
eas build --platform android --profile preview

# Build IPA (iOS)
eas build --platform ios
```
