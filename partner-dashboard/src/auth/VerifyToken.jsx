import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { verifyToken } from '../api/auth.js';
import { JWT_KEY } from '../api/client.js';

export default function VerifyToken() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { jwt } = await verifyToken(token);
        localStorage.setItem(JWT_KEY, jwt);
        setState('success');
        navigate('/dashboard', { replace: true });
      } catch (err) {
        setState('error');
        setErrorMsg(err.response?.data?.error || 'Invalid or expired link');
      }
    })();
  }, [token, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        {state === 'verifying' && <p className="text-text-secondary">Verifying…</p>}
        {state === 'error' && (
          <div>
            <p className="text-danger font-medium">Could not sign you in: {errorMsg}</p>
            <a href="/login" className="text-accent underline mt-4 inline-block">
              Request a new link
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
