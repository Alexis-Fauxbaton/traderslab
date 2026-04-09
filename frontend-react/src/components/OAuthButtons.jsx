import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export default function OAuthButtons({ setError }) {
  const { oauthLogin } = useAuth();
  const navigate = useNavigate();
  const googleBtnRef = useRef(null);

  const handleGoogleResponse = useCallback(async (response) => {
    try {
      await oauthLogin('google', response.credential);
      navigate('/');
    } catch (err) {
      setError?.(err.message || 'Erreur Google Sign-In');
    }
  }, [oauthLogin, navigate, setError]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !window.google?.accounts) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
    });
    window.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: 'filled_black',
      size: 'large',
      width: '100%',
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'center',
    });
  }, [handleGoogleResponse]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <>
      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 h-px bg-slate-700" />
        <span className="text-xs text-slate-500 uppercase tracking-wider">ou</span>
        <div className="flex-1 h-px bg-slate-700" />
      </div>
      <div ref={googleBtnRef} className="flex justify-center [&>div]:!w-full" />
    </>
  );
}
