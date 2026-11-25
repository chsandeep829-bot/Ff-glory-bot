# Guild Glory storage setup (Firebase Auth + Turso + Backblaze B2)

The dashboard keeps Firebase Authentication for email/password and Google sign-in. Firestore is no longer used. The Pages Function at `functions/api/[[path]].js` verifies Firebase ID tokens, stores each user's workspace in Turso, and uploads images to Backblaze B2.

## 1. Create a Turso database

1. Create a database in your Turso account.
2. Copy its database URL (usually `libsql://YOUR-DATABASE-YOUR-ORG.turso.io`).
3. Create a database auth token.
4. Keep the token private. Do not paste it into GitHub or the browser.

## 2. Create a Backblaze B2 bucket

1. Create a bucket, preferably **Private**.
2. Copy the bucket name and bucket ID.
3. Create an application key restricted to this bucket with file read and file write permissions.
4. Save the key ID and application key securely.
5. Uploads are limited to PNG, JPEG, WebP or GIF and 5 MB per file. Files are stored under a per-user UID prefix.

## 3. Configure Cloudflare Pages secrets

In Cloudflare Dashboard:

1. Open **Workers & Pages → ff-glory-dashboard**.
2. Open **Settings → Variables and Secrets**.
3. Add these as encrypted secrets (not plain-text frontend variables):

| Name | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | Your Turso database URL |
| `TURSO_AUTH_TOKEN` | Your Turso auth token |
| `B2_KEY_ID` | Backblaze application key ID |
| `B2_APPLICATION_KEY` | Backblaze application key |
| `B2_BUCKET_ID` | Backblaze bucket ID |
| `B2_BUCKET_NAME` | Backblaze bucket name |
| `FIREBASE_API_KEY` | Firebase Web API key (same project as the login page) |

4. Add secrets to both **Production** and **Preview** if you use preview deployments.
5. Save changes and trigger a new deployment.

The Firebase project ID is set in the function code to `studio-3607214974-ad41a`. Firebase Authentication remains the login provider. In Firebase Console, enable Email/Password and Google and add `ff-glory-dashboard.pages.dev` to Authentication → Settings → Authorized domains.

## 4. Test

Open https://ff-glory-dashboard.pages.dev, sign in, then save a Guild ID and an account UID. Create a BR request to verify the workspace saves. In Settings, upload a small image to test B2.

The first successful API call creates the `guild_workspaces` table in Turso automatically. Firestore is not required and Firestore rules are not used.

## Security notes

- Never put Turso tokens or Backblaze application keys in `index.html`, GitHub, Termux screenshots, or chat messages.
- If a secret is exposed, revoke it and create a replacement.
- The API checks the Firebase ID token on every request and scopes database rows and B2 object names to the authenticated Firebase UID.
- The current dashboard stores account UIDs and BR request records only. It does not automate gameplay, join matches, or alter in-game Glory.
