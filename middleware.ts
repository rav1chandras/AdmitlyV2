import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;
    const role = (token?.role as string) || '';

    // /profile merged into /dashboard — redirect for bookmarks/old links
    if (path === '/profile' || path.startsWith('/profile/')) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    // Block needs_role users from accessing anything except login
    if (role === 'needs_role' && !path.startsWith('/login')) {
      return NextResponse.redirect(new URL('/login?google_callback=1', req.url));
    }

    // Admin-only routes
    if (path.startsWith('/admin') && role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    // Counselor routes — allow counselors and admins
    if (path.startsWith('/expert-portal') && !['counselor', 'admin'].includes(role)) {
      // Students with active assignments can access expert-portal
      if (role !== 'student') {
        return NextResponse.redirect(new URL('/profile', req.url));
      }
    }

    // Pending counselors can only access pending-approval, settings, help, login
    if (role === 'pending_counselor' || role === 'rejected') {
      const allowed = ['/pending-approval', '/settings', '/help', '/api/', '/login'];
      if (!allowed.some(a => path.startsWith(a))) {
        return NextResponse.redirect(new URL('/pending-approval', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

// Only protect app routes, not public/static/API auth routes
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/profile/:path*',
    '/colleges/:path*',
    '/essays/:path*',
    '/counselor/:path*',
    '/dates/:path*',
    '/admin/:path*',
    '/expert-portal/:path*',
    '/expert-sessions/:path*',
    '/settings/:path*',
    '/help/:path*',
    '/score/:path*',
    '/essay-lab/:path*',
    '/subscribe/:path*',
    '/pending-approval/:path*',
  ],
};
