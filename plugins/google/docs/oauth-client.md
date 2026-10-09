---
title: Setting up Google sign-in
order: 0
dependents: true
excludeServices: [google-keep]
---

# Setting up Google sign-in

Gmail, Google Calendar, Drive, Docs, Sheets and *Google APIs* connections sign in with an OAuth client from your own Google Cloud project. An administrator sets it up once for everyone, under **Plugins → Google → Settings**. Users can also bring their own client in the connect dialog, under *Advanced*.

## 1. Create a project and turn on the APIs

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project, for example *Switchboard*.
2. Under **APIs & Services → Library**, enable each API you will use: **Gmail API**, **Google Calendar API**, **Google Drive API**, **Google Docs API**, **Google Sheets API**.

## 2. Configure the consent screen

1. Go to **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) and choose **Get started**.
2. Enter an app name, for example *Switchboard*, and your email address.
3. Under **Audience**, choose:
   - **Internal** if everyone uses accounts from your own Google Workspace organization. There is no review and no expiry.
   - **External** otherwise, for example for personal Gmail accounts. Then add every account that will connect as a **test user**.

## 3. Create the OAuth client

1. Go to **Clients** (or **APIs & Services → Credentials**) and choose **Create client**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs**, add:

   ```text
   {{callbackUrl}}
   ```

4. Choose **Create**, then copy the **client ID** and **client secret**.

## 4. Enter it in Switchboard

Under **Plugins → Google → Settings**, paste the client ID and secret and save. Users can now connect their Google accounts.

## Good to know

> [!IMPORTANT]
> **Sign-ins expire weekly in testing mode.** For an *External* app in **Testing**, Google lets sign-ins expire after **7 days**, and connections then need **Reconnect**. To avoid this, choose **Publish app** under **Audience**. Google shows an *"unverified app"* warning when signing in, which you can click through (**Advanced → Go to Switchboard**). That is fine for personal use, for up to 100 users. Verification is only needed for wider use.

- **"Access blocked: app has not completed verification":** the account is not a test user (step 2), or the app is still in testing.
- **`redirect_uri_mismatch`:** the redirect URI in step 3 must be exactly `{{callbackUrl}}`.
- **"… API has not been used in project …":** enable that API (step 1). It can take a few minutes to apply.
- **Google Keep** works differently: see [Connecting Google Keep](/docs/google-keep/setup).
