import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'demo-omnigalactic-offline';
const TEST_EMAIL = 'offline-e2e@example.com';
const TEST_PASSWORD = 'offline-e2e-password';

export default async function globalSetup() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Offline E2E tests must run inside the Firebase Auth and Firestore emulators.');
  }

  const app = initializeApp({ projectId: PROJECT_ID }, 'offline-e2e-seed');
  const emulatorAuth = getAuth(app);

  try {
    await emulatorAuth.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      emailVerified: true,
      displayName: 'Offline E2E',
    });
  } catch (error: any) {
    if (error?.code !== 'auth/email-already-exists') throw error;
  }

  await deleteApp(app);
}
