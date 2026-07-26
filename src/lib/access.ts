import type { User } from 'firebase/auth';

export const OWNER_EMAIL = 'msmith235@gmail.com';

export function isOwnerUser(user: User | null | undefined): boolean {
  return user?.emailVerified === true && user.email?.trim().toLowerCase() === OWNER_EMAIL;
}
