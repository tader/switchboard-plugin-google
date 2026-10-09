---
title: Connecting Google Keep
order: 1
---

# Connecting Google Keep

Google only offers the Keep API to **Google Workspace** organizations, and its sign-in screen never lets users approve Keep access (*"Some requested scopes cannot be shown"*). Google considers this intended behavior. Keep therefore connects through a **service account with domain-wide delegation**. A Workspace administrator authorizes the service account once, and it can then read and write Keep notes for a user in the organization without that user signing in.

> [!NOTE]
> Personal `@gmail.com` accounts cannot use the Keep API at all.

## What you need

- A Google Cloud project, where you can create service accounts.
- A **super administrator** of the Workspace organization, for step 5.
- The email address of the Workspace user whose notes Switchboard should use.

## 1. Create a service account

1. Open [console.cloud.google.com](https://console.cloud.google.com) and select or create a project.
2. Go to **IAM & Admin → Service Accounts** and choose **Create service account**.
3. Give it a name, such as *switchboard-keep*, and choose **Done**. It needs no roles or permissions in the project.

## 2. Create a key

1. Open the service account, go to the **Keys** tab and choose **Add key → Create new key**.
2. Choose **JSON** and **Create**. A file downloads; you will paste its contents into Switchboard.

> [!TIP]
> If Google says key creation is disabled, the organization policy *Disable service account key creation* (`iam.disableServiceAccountKeyCreation`) is on. This is the default for organizations created since 2024. An organization policy administrator can turn it off for this project under **IAM & Admin → Organization policies**.

## 3. Turn on the Keep API

In the same project, go to **APIs & Services → Library**, search for **Google Keep API** and choose **Enable**.

## 4. Copy the client ID

On the service account's **Details** tab, copy the **Unique ID**, a long number. This is the service account's OAuth client ID.

## 5. Authorize it in Workspace

This needs a super administrator.

1. Open [admin.google.com](https://admin.google.com) and go to **Security → Access and data control → API controls**.
2. Under **Domain-wide delegation**, choose **Manage domain-wide delegation → Add new**.
3. Enter the client ID from step 4 and these OAuth scopes, separated by a comma:

   ```
   https://www.googleapis.com/auth/keep,https://www.googleapis.com/auth/keep.readonly
   ```

   Leave out the first scope if Switchboard should only read notes.
4. Choose **Authorize**. It can take a few minutes, occasionally longer, before Google applies it.

## 6. Connect in Switchboard

1. On the [Connections](/connections) page, choose **Connect → Google Keep**.
2. Paste the whole JSON key file into **Service account key**.
3. Under **Act as**, enter the email address of the Workspace user whose notes to use.
4. Choose the access level and **Continue**.

Switchboard stores the key encrypted and never shows it again. Repeat step 6 to connect more users with the same key.

## What the API can do

Google's Keep API can list, create, get and delete notes, download attachments, and share notes with others. It cannot edit an existing note; to change one, create a new note and delete the old one. Try it in the [console](/console) under **API reference**.

## Troubleshooting

| Error | Cause |
|---|---|
| `unauthorized_client` … *domain-wide delegation* | Step 5 is missing, the client ID or scopes do not match exactly, or Google has not applied the change yet. The scopes requested must be in the authorized list: *View notes* needs `keep.readonly`, the other level needs `keep`. |
| *Google Keep API has not been used in project … or it is disabled* | Step 3 is missing, or the key is from another project. |
| `invalid_grant` … *Invalid email or User ID* | The **Act as** address is not a user in the Workspace organization. |
| *This is not a service account key file* | Paste the downloaded JSON file itself, not the client ID or an OAuth client file. |

## Security

> [!WARNING]
> With domain-wide delegation, the key can act as **any** user in the organization, for the authorized scopes. Treat it like an administrator password.

- Authorize only the Keep scopes.
- Remove the key in Google Cloud when you no longer use it. This immediately stops every Switchboard connection made with it.
- Check what was done under [Activity](/activity).
