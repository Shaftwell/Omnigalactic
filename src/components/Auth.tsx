import React from 'react';
import { signInForOfflineTest, signInWithGoogle } from '../firebase';
import { LogIn, Rocket, Shield, Zap, Globe } from 'lucide-react';
import { motion } from 'motion/react';
import StarField from './StarField';

export default function Auth() {
  const [error, setError] = React.useState<string | null>(null);

  const handleLogin = async () => {
    try {
      setError(null);
      if (import.meta.env.VITE_OFFLINE_E2E === 'true') {
        await signInForOfflineTest();
      } else {
        await signInWithGoogle();
      }
    } catch (err: any) {
      console.error('Login error:', err);
      if (err.code === 'auth/unauthorized-domain') {
        setError('This domain is not authorized in Firebase. Please add it to "Authorized Domains" in the Firebase Console.');
      } else {
        setError(err.message || 'Failed to sign in. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <StarField />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md p-8 bg-slate-900/50 backdrop-blur-xl rounded-[2.5rem] border border-white/10 shadow-2xl text-center"
      >
        <div className="mb-8 flex justify-center">
          <div className="w-24 h-24 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/20 rotate-12">
            <Rocket className="w-12 h-12 text-white -rotate-12" />
          </div>
        </div>

        <h1 className="text-4xl font-black text-white mb-3 tracking-tighter">
          <span className="text-indigo-400">OMNIGALACTIC</span>
        </h1>
        
        <p className="text-slate-400 mb-10 font-medium leading-relaxed">
          Your own mission control — calendar, tasks, notes, budget, and more, synced across your devices.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-2xl text-red-400 text-sm font-medium">
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          data-testid="access-command-center"
          className="w-full bg-white text-slate-950 font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-3 hover:bg-indigo-50 transition-all active:scale-[0.98] shadow-xl shadow-white/5 group"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.67-.35-1.39-.35-2.09s.13-1.42.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Access Command Center
        </button>

        <div className="mt-8 pt-8 border-t border-white/5">
          <div className="flex items-center justify-center gap-6 text-slate-500">
            <div className="flex flex-col items-center gap-1">
              <Shield className="w-5 h-5 text-indigo-500/50" />
              <span className="text-[10px] uppercase font-bold tracking-widest">Secure</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Zap className="w-5 h-5 text-indigo-500/50" />
              <span className="text-[10px] uppercase font-bold tracking-widest">Instant</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Globe className="w-5 h-5 text-indigo-500/50" />
              <span className="text-[10px] uppercase font-bold tracking-widest">Sync</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
