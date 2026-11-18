# Roam · Trip Planner

A React Native app built with Expo, Expo Router, and TypeScript. Plan trips, arrange daily activities, and keep an eye on your estimated budget. It also runs in a browser with React Native Web.

## Install on an Android phone

The standalone test build is an APK. Once built, copy `artifacts/roam-trip-planner.apk` to the phone, open it in Files, allow installation from that app if Android asks, and install **Roam**. The APK includes its code and images; Expo Go and a running laptop server are not needed. Guest planning works offline. Online signup/signin, verification, and external hotel searches require internet.

Version 1.2.2 uses Android versionCode 6, so it can update the earlier test APK using the same signing key. Existing plans remain in guest mode. Signed-in accounts use separate local trip lists.

To build on this Windows machine:

```sh
cd trip-planner
npm run setup:android
npm run build:apk
```

The setup downloads a portable Java 17 and Android SDK into `.tools/` without changing system environment variables. The build temporarily aliases this Windows workspace to an unused R:, S:, or T: drive to avoid Windows path-length failures, then removes its own alias. Expo prebuild uses `--no-clean` to keep build caches. `npm run build:apk:direct` is available when the project already has a short path. The first build downloads additional Android/Gradle dependencies and can take a while. The release-mode APK uses the template's local test signing key; use a private production signing key before store distribution. Physical-device behavior still needs to be tested on your phone.

To download the finished APK over the same Wi-Fi network, run `node scripts/serve-apk.cjs` and open its printed phone URL. The server exposes only the APK and its download page. The computer must stay on until the download finishes.

An optional EAS cloud APK profile is also available with `npm run build:apk:cloud`; it requires an Expo account and login.

## Development preview

From the parent workspace:

```sh
cd trip-planner
npm install
npm start
```

Open the development server's QR code with a compatible Expo Go app on your phone. Keep the phone and computer on the same network. A native device run has not yet been verified.

Other launch options, from `trip-planner`:

```sh
npm run web       # Browser preview
npm run android   # Android emulator; requires Android SDK/emulator setup
```

## Features

- Create, edit, and delete trips with dates, destination, budget, and a photo cover.
- Search trips and filter upcoming, ongoing, or past adventures.
- Add activities to individual days, mark them complete, and remove them.
- Compare estimated activity costs with the trip budget, in Indian rupees (INR).
- Save plans locally with AsyncStorage, with error messages and a save retry action.
- Generate a 1–14 day itinerary from destination, group budget, dates, travelers, interests, pace, and stay preference.
- Choose AI planner for itineraries using researched tourist places, or keep using the offline planner. Suggest more excludes previously shown names and links; strict budget and up to 10% flexibility are available.
- See estimated stay, food, local transport, activities, and contingency costs, with hotel-area/type searches on Maps.
- Email/password signup and signin through Supabase, email verification/resend, persistent sessions, and signout.
- Account network requests stop waiting after 15 seconds and show a connection error, preserving form inputs so users can retry or continue as a guest. A signup timeout cannot confirm whether the server created the account; check the inbox before trying again.
- Success/failure notices for loading, creating, updating and deleting trips/activities, and for account actions. A save succeeds only after storage confirms the write.

Trip dates use `YYYY-MM-DD`; activity times use the 24-hour `HH:MM` format. Trips can span up to 60 days, including the first and last day. Activities must fall within the trip's dates. Budgets and costs must be nonnegative; costs are estimates, and completed activities still count toward the planned total.

Three fictional demo plans are created on the first launch, with dates relative to today. Deleting all trips keeps the list empty on subsequent launches. Demo costs are sample data, not live prices.

Trip data stays in local storage on the current device/browser, separated by authenticated user ID; it does not sync between devices. Online account identity is managed by Supabase. Native session tokens use Expo SecureStore; browser sessions use browser storage. Passwords are sent to Supabase and are not saved by the app. Guest mode preserves the original app's local storage key. Clearing app/browser storage removes saved plans. If saved data is damaged, writes stop; explicit recovery backs up the original bytes before resetting that account's local trip list.

The offline planner uses local rules and researched destination profiles for Jaipur, Goa, Manali, Delhi, Mumbai and Bali. Unknown destinations get a clearly labeled general template. Its costs are authored INR planning allowances, and its stay suggestions are area/type searches. AI planner supports the same six destinations using the backend described below; unsupported destinations are rejected before an AI request. Both modes exclude travel to/from the destination, visas and shopping. Neither mode includes live hotel prices, availability checks or booking.

## Connect the free-tier AI planner

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey).
2. In the connected Supabase project, open [Edge Functions → Secrets](https://supabase.com/dashboard/project/ylbngtixzuwuiylvjite/functions/secrets). Save it as `GEMINI_API_KEY`. Never put this key in an Expo public variable or in the mobile app.
3. The `generate-trip-plan` Edge Function uses `gemini-3.5-flash-lite` text generation with structured outputs and minimal thinking for these short itineraries. It does not invoke the paid Google Maps grounding tool. An optional `GEMINI_MODEL` server secret can select a model that supports structured outputs. Free-tier usage limits still apply and depend on the Google project; this setup does not enable billing.
4. Sign in to Roam, open Smart planner, choose **AI planner**, enter a supported destination and generate. **Suggest more** requests alternatives while excluding earlier names and navigation URLs. Costs target the original budget; the optional flexibility allows at most 10% extra and displays the difference.

The backend validates the caller with Supabase Auth, selects a researched destination catalog, removes previous suggestions, and makes one stateless Gemini Interactions request to arrange the itinerary. Names, place types and Maps navigation links come from the catalog; the model chooses existing source IDs. Official tourism references are shown separately from Maps navigation. Unsupported destinations, insufficient remaining places, fabricated IDs, repeated/excluded places, malformed results and totals outside the selected limit are rejected. The finite catalog can run out of alternatives, especially for longer trips. Stay recommendations are areas and room types, not named hotels. Popularity is based on inclusion in tourism references, not measured crowds or a current ranking. All amounts are planning estimates.

Unsupported destinations are rejected locally before any network request. The backend also validates the public catalog before outgoing Auth requests, while actual authentication still gates every Gemini call. Provider requests have a 12-second server deadline; the app uses a 15-second planner deadline. When a supported destination's AI request stalls or the provider is unavailable, the app creates an explicitly labelled **Offline researched plan** from the local catalog and authored cost allowances. This fallback uses the same exclusions, unique-place requirements and strict/+10% budget ceiling; it never invents locations or changes estimates to force a fit. Cancellation and rejected sessions never trigger fallback. Budget failures or insufficient remaining places retain the previous preview with a specific explanation.

The UI allows cancellation, discards stale responses after edits and keeps Maps navigation links with saved activities. There are no automatic provider retries. Provider quota, temporary provider throttling, setup errors, a request already in progress, and the local cooldown have distinct error codes. Backend diagnostics contain only safe status/quota metadata, never keys, user prompts or raw provider responses. The in-memory per-user cooldown applies only within a warm isolate; configure durable quotas before opening the service broadly. The endpoint verifies the bearer token itself, so deploy it with `verify_jwt: false`; a missing or invalid user session is still rejected before AI access.

No Gemini key is bundled in the APK. Saving the server secret takes effect without another APK rebuild. If it is missing, AI mode reports that it is unavailable and offers the offline planner. Synthetic tests cover the integration. On 2026-10-28, an authenticated phone request using the free planner completed with HTTP 200 in about 6.9 seconds and the user confirmed that the plan appeared. This verifies one live generation, not a guaranteed response time or future quota availability.

Version 1.2.0 used Google Maps grounding on Gemini 3.8, which is unavailable on its free API tier. Its provider HTTP 429 was also incorrectly displayed as the app's local cooldown. Version 1.2.1 removes that paid tool dependency and distinguishes these errors. Legacy Gemini 2.5 models are not a reliable workaround for newly created projects because Google restricts their access to existing active users.

References: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [model access and deprecations](https://ai.google.dev/gemini-api/docs/deprecations), [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets).

## Connect online authentication

Create/connect a Supabase project, then copy `.env.example` to `.env.local` and set its project URL and **publishable** key (a legacy **anon** key is also accepted). Never put a `service_role` or `sb_secret_` key into an Expo public variable. The app rejects those keys. No custom database tables are required for authentication.

For the requested direct signup flow, keep Email signup enabled and open **Authentication → Sign In / Providers**. In the **User Signups** section above the provider list, turn **Confirm email** off and click **Save changes**. Supabase creates the account through its Auth API and returns a session; Roam immediately signs in and shows the account-created success message. This setting stops signup confirmation emails and removes the localhost email redirect from the signup flow. It is a hosted project setting, so changing `.env.local` or rebuilding alone does not switch it off. The current connector does not expose an auth-settings update action; use the dashboard toggle.

The client also handles projects where confirmation is enabled: a signup without a session shows the verification screen. With Supabase's default email, copy the confirmation link into Roam's **Verification code or link** field, or use a numeric code if the project's template includes one. Roam verifies the token against the configured project and never follows the pasted redirect. Email sending limits and SMTP setup apply if email confirmation or password recovery is enabled.

Public configuration is embedded at build time. Rebuild the APK after setting it. For EAS, configure both `EXPO_PUBLIC_SUPABASE_*` variables in the build environment; local `.env*` files are excluded from upload. If the project is not connected, account buttons are disabled and the app explicitly offers guest planning. This workspace is connected through its ignored `.env.local`; do not commit that file. Direct signup and session persistence are covered by synthetic browser tests; a complete signed-in session still needs to be checked on the Android phone.

References: [Supabase React Native authentication](https://supabase.com/docs/guides/auth/quickstarts/react-native), [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Free-plan template limits](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier), [Hosted email testing](https://supabase.com/docs/guides/auth/testing-auth-flows), [Expo SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/).

## Project structure

```text
src/app/                  Expo Router screens and layout
src/components/           Shared UI, trip form, and activity form
src/lib/trips.ts           Types, date/budget helpers, validation, and demo data
src/lib/planner.ts         Personalized itinerary and cost estimates
src/lib/trip-storage.ts    Serialized, durable local storage per account
src/lib/supabase.ts        Public client configuration and secure native session storage
src/lib/theme.ts           Colors, typography, and bundled cover images
src/store/TripsProvider.tsx  Trip state and local persistence
src/store/AuthProvider.tsx   Online session and account actions
src/store/FeedbackProvider.tsx  Accessible queued success/error messages
assets/covers/            Bundled photo covers
tests/trips.test.ts        Domain validation and calendar tests
```

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build:web
```

The web build is exported to `dist/`. These checks do not replace testing on a physical Android or iOS device.

## Photo credits

Cover photography is sourced from [Unsplash](https://unsplash.com/) and bundled with the app:

- [Bali cover](https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=1000&q=85&fit=crop)
- [Mountain cover](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1000&q=85&fit=crop)
- [City cover](https://images.unsplash.com/photo-1599661046289-e31897846e41?w=1000&q=85&fit=crop)
- [Beach cover](https://images.unsplash.com/photo-1519046904884-53103b34b206?w=1000&q=85&fit=crop)

Images serve as mood covers and do not verify a trip's destination or accommodation.
