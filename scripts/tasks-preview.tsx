import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TaskWorkspace} from '../src/hml/tasks';
import '../src/styles.css';
const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={qc}><main className='mx-auto max-w-6xl space-y-5 p-6'><p className='text-xs text-muted-foreground'>PRÉVIA LOCAL · DADOS FICTÍCIOS · SEM ENVIO DE MENSAGENS</p><TaskWorkspace companyId={1}/></main></QueryClientProvider>);
