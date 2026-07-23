import { useState } from 'react';
import { Orbit } from 'lucide-react';
import { signInWithGoogle } from '../firebase';

export default function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 px-6 text-center">
      <Orbit className="w-16 h-16 text-indigo-400" />
      <h1 className="text-4xl font-bold tracking-tight">Omnigalactic</h1>
      <p className="text-gray-400 max-w-sm">
        Your own mission control. Sign in with Google to get a fresh site,
        and share it with anyone who has a Google account.
      </p>
      <button
        onClick={handleSignIn}
        disabled={busy}
        className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition-colors"
      >
        {busy ? 'Signing in…' : 'Sign in with Google'}
      </button>
      {error && <p className="text-red-400 text-sm max-w-sm">{error}</p>}
    </div>
  );
}
