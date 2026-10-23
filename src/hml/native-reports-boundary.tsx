import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Notice, useCompanyModules } from './modules';
import { useActiveEmpresa } from '@/hooks/use-active-empresa';

// Gate mounting, so native report queries do not run for a CRM-only company.
export function NativeReportsBoundary({ children }: { children: ReactNode }) {
  const { activeEmpresaId } = useActiveEmpresa();
  const modules = useCompanyModules();
  if (!activeEmpresaId) return <Notice title="Selecione uma empresa" />;
  if (modules.isPending) return <p>Carregando módulos da empresa…</p>;
  if (modules.isError) return <Notice title="Não foi possível verificar os módulos">
    <button type="button" onClick={() => modules.refetch()}>Tentar novamente</button>
  </Notice>;
  if (!modules.data?.atendimento_ia) return <Notice title="Relatórios do atendimento IA">
    <p>Esta empresa não tem o atendimento IA habilitado.</p>
    {modules.data?.crm && <Link to="/crm" className="text-primary underline">Abrir CRM comercial</Link>}
  </Notice>;
  return children;
}

