// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Modulo Inadimplencia do Gestor
// Financeiro CCS. Menu com submenus (Painel, Titulos em Atraso, Clientes
// Inadimplentes, Regua de Cobranca). As telas ainda sao placeholders: a
// estrutura de navegacao ja esta no ar pra validar o layout; cada submenu
// recebe sua implementacao numa proxima fase.
import React from 'react';
import { AlertTriangle } from 'lucide-react';

// Casca padrao de uma tela do modulo, com aviso de "em construcao".
function EmConstrucao({ titulo, descricao }) {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-prim-400 mb-1">{titulo}</h1>
      <p className="text-sm text-gray-400 mb-4">{descricao}</p>
      <div className="card p-8 flex items-start gap-3">
        <AlertTriangle size={20} className="text-acc-500 shrink-0 mt-0.5" />
        <div>
          <div className="text-gray-200 font-medium">Tela em construção</div>
          <p className="text-sm text-gray-400 mt-1">
            O menu <span className="text-prim-300">Inadimplência</span> e seus submenus
            já estão publicados. O conteúdo desta tela entra numa próxima fase.
          </p>
        </div>
      </div>
    </div>
  );
}

export function InadPainel() {
  return <EmConstrucao
    titulo="Inadimplência · Painel"
    descricao="Visão geral da inadimplência: valores em atraso, evolução e indicadores." />;
}

export function InadTitulos() {
  return <EmConstrucao
    titulo="Inadimplência · Títulos em Atraso"
    descricao="Relação de títulos vencidos e não liquidados, com filtros por filial e período." />;
}

export function InadClientes() {
  return <EmConstrucao
    titulo="Inadimplência · Clientes Inadimplentes"
    descricao="Clientes com pendências, agrupando os títulos em atraso por cliente." />;
}

export function InadCobranca() {
  return <EmConstrucao
    titulo="Inadimplência · Régua de Cobrança"
    descricao="Acompanhamento das ações de cobrança e dos contatos com cada cliente." />;
}
