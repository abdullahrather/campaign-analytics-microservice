import { useCallback, useEffect, useState } from 'react';
import { api, loadSession, setExpiredHandler, type User } from './api';
import { useTheme } from './hooks';
import { CampaignPage, Login, Overview } from './pages';

const readRoute = (): string | null =>
  window.location.hash.match(/^#\/campaigns\/(.+)$/)?.[1] ?? null;

const App = () => {
  const [user, setUser] = useState<User | null>(() => loadSession()?.user ?? null);
  const [campaignId, setCampaignId] = useState(readRoute);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onChange = () => setCampaignId(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const signOut = useCallback(() => {
    api.logout();
    setUser(null);
  }, []);

  useEffect(() => setExpiredHandler(signOut), [signOut]);

  if (!user) return <Login onLogin={setUser} />;

  return (
    <>
      <nav className="topbar" aria-label="Main">
        <a href="#/" className="brand">
          Campaign Analytics
        </a>
        <div className="topbar-actions">
          <span className="muted small who">
            {user.email} · {user.role === 'ADMIN' ? 'Admin' : 'Advertiser'}
          </span>
          <button type="button" className="button" onClick={toggle}>
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button type="button" className="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="page">
        {campaignId ? (
          <CampaignPage
            key={campaignId}
            id={campaignId}
            onBack={() => {
              window.location.hash = '#/';
            }}
          />
        ) : (
          <Overview
            user={user}
            onOpen={(id) => {
              window.location.hash = `#/campaigns/${id}`;
            }}
          />
        )}
      </main>
    </>
  );
};

export default App;
