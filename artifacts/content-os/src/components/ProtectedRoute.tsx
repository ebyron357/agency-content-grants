import { useAuth } from "../hooks/useAuth";
import { Redirect } from "wouter";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Wraps a route and redirects unauthenticated users to /login.
 * Shows nothing while the session check is in flight (avoids flash).
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}
