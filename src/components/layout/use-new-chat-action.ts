import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createWorkspaceScopedNewSession } from '@/lib/workspace-session';

export function useNewChatAction(): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    navigate('/');
    void createWorkspaceScopedNewSession();
  }, [navigate]);
}
