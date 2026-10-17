import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { GoogleAnalytics } from 'tanstack-router-ga4';
import Footer from '../components/Footer';
import Header from '../components/Header';
export const Route = createRootRoute({ component: Demo });
function Demo() {
  return (
    <div className="flex min-h-screen flex-col">
      <GoogleAnalytics measurementId="G-CJJ7XP4N79" />
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <Toaster />
    </div>
  );
}
