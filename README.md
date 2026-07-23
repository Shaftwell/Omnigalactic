# Omnigalactic

A multi-user mission control site. Anyone with a Google account can sign in
and instantly get their own fresh site — with tasks, a shopping list, and
notes — and share it with anyone else who has a Google account.

Built with React, Vite, Tailwind CSS, Firebase Authentication (Google
sign-in), and Firestore with an offline-first persistent cache.

## How sharing works

- Signing in with Google for the first time lands you on the site picker,
  where you create your own site. You can create as many as you like.
- On a site's **Members** tab, invite someone by their Google account email.
- The next time that person signs in to Omnigalactic, the invitation appears
  on their site picker; accepting it makes them a full member.
- Members can add and edit everything on the site. Only the owner can remove
  members or delete the site. Firestore security rules enforce all of this
  server-side — no one can see a site they aren't a member of or invited to.

## Move this branch into its own repository

This project was built from scratch on an orphan branch (it shares no history
or content with any other project). To give it its own `Omnigalactic` repo:

1. Create an empty repository named `Omnigalactic` on GitHub (no README).
2. Then run:

```bash
git clone --branch claude/omnigalactic-multiuser-site-yqycit \
  https://github.com/Shaftwell/SmithmanOmingalacticFirebase.git Omnigalactic
cd Omnigalactic
git branch -m main
git remote set-url origin https://github.com/Shaftwell/Omnigalactic.git
git push -u origin main
```

## Firebase setup (one time)

1. Create a new Firebase project at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method**: enable **Google**.
3. **Firestore Database**: create a database (production mode).
4. **Project settings → Your apps**: add a Web app and copy its config
   values into `.env.local` (see `.env.example`).
5. Deploy the security rules and hosting:

```bash
npm ci
npm run build
npx firebase-tools deploy --only firestore:rules,hosting
```

Also add your hosting domain (and `localhost`) under
**Authentication → Settings → Authorized domains** so the Google sign-in
popup works.

## Local development

Requires Node.js 22.

```bash
npm ci
cp .env.example .env.local   # then fill in your Firebase web config
npm run dev
```

The app runs at <http://localhost:3000>.

## Validation

```bash
npm run lint   # TypeScript type-check
npm run build  # production build
```

## Data model

```
sites/{siteId}
  name, ownerUid, ownerEmail
  memberUids[], memberEmails[]   # current members
  invitedEmails[]                # pending invitations (Google emails)
  tasks/{id}     # { text, done, createdByEmail, createdAt }
  shopping/{id}  # { text, done, createdByEmail, createdAt }
  notes/{id}     # { text (title), body, createdByEmail, createdAt }
```

`firestore.rules` gates every read and write on membership of the site, and
allows exactly one write to non-members: an invited user adding themselves
as a member (accepting the invitation).
