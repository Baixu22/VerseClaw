import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createWorkspaceScopedNewSession } from '@/lib/workspace-session';
import { toastUserError } from '@/lib/user-error';

export function useNewChatAction(): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    void createWorkspaceScopedNewSession().then((sessionKey) => {
      if (sessionKey) navigate('/');
    }).catch(toastUserError);
  }, [navigate]);
}
