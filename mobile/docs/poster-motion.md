# Poster motion

Poster cards compress to 97% on both iOS and Android. Reanimated runs the transform spring on the UI thread. Press-in uses a 120 ms critically damped spring. Release uses a 300 ms spring with a 0.8 damping ratio. Repeated presses retarget the current spring instead of resetting the scale. A canceled press releases the card without opening it.

React Native Pressable keeps native accessibility activation, keyboard activation and scroll cancellation. Its press callbacks start the animations on the React Native runtime. The animation frames do not require React renders or per-frame JavaScript callbacks. Navigation starts from onPress immediately. It does not wait for the release spring. Reduced Motion disables the scale movement.

The route uses the existing native push. iOS keeps the standard Expo Router Stack. Android keeps ExperimentalStack and its predictive back support. There is no custom back gesture or animation override.

## Native zoom decision

Expo Router has a public Link.AppleZoom API for iOS 18 and later, including SDK 56. Its documentation marks it alpha and lists an approximately one-second delay during rapid open, close and open interactions. It also lists visual problems with native headers. It has no Android zoom implementation. Android ExperimentalStack does not support animation overrides. These limits do not support a reliable matching poster-to-page transition on both platforms today.

A future opt-in test route can use a Link with asChild, wrap just the poster in Link.AppleZoom, and place Link.AppleZoomTarget around a destination artwork container that has its size on first render. Use a headerless standard iOS Stack, no Link.Preview and no custom back handlers. Keep the current card path as the fallback. Before adoption, verify rapid open, close and open, interrupted dismissal, slow and canceled return gestures, large text, Reduced Motion and recycled source cards on physical devices. Keep Android on its native push until a documented compatible option is available.

Basic type checks and unit tests cannot confirm tactile feel or Android predictive back. Check spring interruption and gesture cancellation on physical iOS and Android devices. Verify predictive back in a standalone Android app that applies the manifest setting.

Sources:

- [React Native Pressable](https://reactnative.dev/docs/pressable)
- [Reanimated withSpring](https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring/)
- [Expo Router zoom transition, including known limitations](https://docs.expo.dev/router/advanced/zoom-transition/)
- [Expo SDK 56 ExperimentalStack](https://docs.expo.dev/versions/v56.0.0/sdk/router/experimental-stack/)
