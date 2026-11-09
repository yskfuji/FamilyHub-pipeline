#!/bin/sh
# iOS アプリを作って、つないだ iPhone（または iPad）に入れて開く。docs/ios/README.md の「実機に入れる」。
# 端末の ID とチームは ios/Config/Local.xcconfig（リポジトリに入れない）か、環境変数 FH_DEVICE_ID で渡す。
set -eu
cd "$(dirname "$0")/../.."

local_value() { sed -n "s/^$1 *= *//p" ios/Config/Local.xcconfig 2>/dev/null | tail -1; }
DEVICE="${FH_DEVICE_ID:-$(local_value FH_DEVICE_ID)}"
PREFIX="${FH_BUNDLE_PREFIX:-$(local_value FH_BUNDLE_PREFIX)}"
if [ -z "$DEVICE" ] || [ -z "$PREFIX" ]; then
  echo "ios/Config/Local.xcconfig に FH_DEVICE_ID と FH_BUNDLE_PREFIX を書いてください（ios/Config/Local.xcconfig.example）。" >&2
  exit 1
fi

xcodegen generate --quiet --spec ios/project.yml
xcodebuild -quiet -project ios/FamilyHub.xcodeproj -scheme FamilyHub -configuration Debug \
  -destination "id=$DEVICE" -derivedDataPath ios/build -allowProvisioningUpdates build
xcrun devicectl device install app --device "$DEVICE" ios/build/Build/Products/Debug-iphoneos/FamilyHub.app
xcrun devicectl device process launch --device "$DEVICE" "$PREFIX.app"
