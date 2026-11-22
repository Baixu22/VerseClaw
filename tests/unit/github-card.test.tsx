import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GitHubCard } from '@/components/assistant-render/GitHubCard';
const open=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/host-api',()=>({hostApi:{shell:{openExternal:open}}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(_key:string,fallback:string)=>fallback})}));
it('renders a profile and opens the exact URL',()=>{
 render(<GitHubCard url="https://github.com/example" />);
 fireEvent.click(screen.getByRole('button'));
 expect(open).toHaveBeenCalledWith('https://github.com/example');
 expect(screen.getByRole('button')).toHaveTextContent('example');
});
it('keeps a repository subpage label free of undefined IDs',()=>{
 render(<GitHubCard url="https://github.com/example/repo/actions" />);
 expect(screen.getByRole('button')).toHaveTextContent('example/repo');
 expect(screen.getByRole('button')).not.toHaveTextContent('undefined');
});
