import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      subscription_status: 'free' | 'pro' | 'premium' | 'cancelled';
      subscription_expires_at: string | null;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    role?: string;
    subscription_status?: string;
    subscription_expires_at?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    subscription_status: string;
    subscription_expires_at: string | null;
  }
}
