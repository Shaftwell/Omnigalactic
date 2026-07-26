import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export const TEST_EMAIL = 'offline-e2e@example.com';

// Path of the test account's per-user data tree, matching userRoot() in
// src/firebase.ts. All admin-side wipes and seeds must target this subtree —
// the app never reads or writes outside it.
export async function adminUserPath(app: App): Promise<string> {
  const user = await getAuth(app).getUserByEmail(TEST_EMAIL);
  return `users/${user.uid}`;
}
