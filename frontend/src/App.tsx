import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import { currentUser, onAuthChange, signOut, type CurrentUser } from './auth';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

export function useCurrentUser(): CurrentUser | undefined {
  const [user, setUser] = useState(currentUser());
  useEffect(() => onAuthChange(() => setUser(currentUser())), []);
  return user;
}

export default function App() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  return (
    <>
      <div id="top-nav" style={{ position: 'sticky', top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{
            href: '/',
            title: 'EventFlow',
            logo: { src: '/favicon.svg', alt: 'EventFlow' },
            onFollow: (e) => {
              e.preventDefault();
              navigate('/');
            },
          }}
          utilities={[
            { type: 'button', text: 'Register', href: '/#register', onClick: (e) => { e.preventDefault(); navigate('/'); setTimeout(() => document.getElementById('register')?.scrollIntoView({ behavior: 'smooth' }), 50); } },
            user
              ? {
                  type: 'menu-dropdown',
                  text: user.email,
                  iconName: 'user-profile',
                  items: [
                    { id: 'dashboard', text: 'Organizer dashboard' },
                    { id: 'signout', text: 'Sign out' },
                  ],
                  onItemClick: async ({ detail }) => {
                    if (detail.id === 'signout') {
                      await signOut();
                      navigate('/');
                    } else navigate('/organizer');
                  },
                }
              : { type: 'button', variant: 'primary-button', text: 'Organizer sign in', iconName: 'lock-private', onClick: (e) => { e.preventDefault(); navigate('/organizer/login'); }, href: '/organizer/login' },
          ]}
        />
      </div>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/organizer/login" element={user ? <Navigate to="/organizer" replace /> : <LoginPage />} />
        <Route path="/organizer" element={user ? <DashboardPage /> : <Navigate to="/organizer/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
