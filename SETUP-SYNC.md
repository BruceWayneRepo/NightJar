# Turning on accounts and sync (one-time, about 15 minutes)

Do this on the laptop, signed in to Chrome with the Google account you want to use
(the same one whose Drive will hold your songs). Everything below is on the free plan.

## 1. Create the Firebase project
1. Open https://console.firebase.google.com and tap **Create a project**.
2. Name it `nightjar`. Turn **Google Analytics off**. Tap **Create project**.

## 2. Turn on Google sign-in
1. Left menu: **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Google** → switch **Enable** on → pick your email as support email → **Save**.
3. **Settings** tab → **Authorized domains** → **Add domain** → type `night-jar-five.vercel.app` → **Add** (and `brucewaynerepo.github.io` too).

## 3. Create the database
1. Left menu: **Build → Firestore Database → Create database**.
2. Location: **asia-south1 (Mumbai)**. Choose **Start in production mode**. **Create**.
3. Open the **Rules** tab, delete everything there, paste the contents of `firestore.rules`
   (from this project), and tap **Publish**.

## 4. Register the web app (this gives the settings Nightjar needs)
1. Tap the gear ⚙ next to "Project Overview" → **Project settings**.
2. Under **Your apps**, tap the web icon **</>**. Nickname: `Nightjar web`. Leave "Firebase Hosting" unticked. **Register app**.
3. You'll see a block that starts with `const firebaseConfig = {`. Copy everything between the `{ }`
   and send it to Claude (or paste it into `src/firebase-config.ts` in place of `null`).
   These values are safe to share: they only name the project. Your data is protected by sign-in and the rules.

## 5. Allow Google Drive (for song backup)
1. Open Google Cloud Console and select the `nightjar` project.
2. Enable the **Google Drive API**.
3. In Google Auth Platform, add the `.../auth/drive.file` scope.
4. Open the OAuth **Web application** client and add this authorized redirect URI:
   `https://night-jar-five.vercel.app/drive-callback.html`
5. In Vercel → your `night-jar` project → **Settings → Environment Variables**, add:
   - `GOOGLE_CLIENT_ID` — the OAuth Web client ID.
   - `GOOGLE_CLIENT_SECRET` — the matching client secret.
   Keep the secret in Vercel only; never commit it or paste it into chat.
6. Redeploy the Vercel project.
7. Open the Vercel-hosted Nightjar, sign in, then choose **Settings → Keep Google Drive connected** and approve once.

The Vercel API helper stores an encrypted refresh credential server-side and returns short-lived access tokens after verifying the signed-in Firebase user. GitHub Pages can host the static app, but it cannot run this Vercel helper; use the Vercel address for automatic Drive renewal.

## What syncs
- Playlists, crossfade and equalizer: live, on every device you sign in on.
- Your song list: every song you import shows up on your other devices.
- Song files: only if **Back up my songs to Google Drive** is on. They go into a
  "Nightjar Music" folder in your Drive and download to a phone the first time you play them there.
  Nightjar uses the `drive.file` permission, so it can only see files it created itself.
- Volume stays per device.

## Good to know
- Google access tokens are short-lived, but the Vercel helper renews them automatically when configured. If you revoke Nightjar's Google permission, change OAuth credentials, or the refresh grant is invalidated, reconnect Drive once in Settings.
- Free Firestore limits (50,000 reads and 20,000 writes a day) are far more than one person uses.
- Song files count towards your normal Google Drive storage.
