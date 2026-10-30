// [21/09/2026 - CRIADO POR ALEXANDRE CARVALHO] Menu "Baixas/Conciliação" > Extrato do banco × Mega.
// O quadro de arrastar o extrato nasceu dentro do Fluxo de Caixa (aba "Contas a pagar: pago × em aberto") e, a pedido
// do Alexandre (validação com a Renata/Quality), ganhou menu e tela próprios. O componente é o mesmo (ExtratoBanco.jsx).
import React from 'react';
import ExtratoBanco from './ExtratoBanco';

export default function ExtratoBancoPage() {
  return (
    <div className="p-6 space-y-5 max-w-[1700px] mx-auto">
      <div>
        <h1 className="text-xl font-bold text-prim-400">Baixas/Conciliação · Extrato do banco × Mega</h1>
        <p className="text-sm text-gray-400">
          Arraste o arquivo de conciliação que o banco manda (extrato CNAB 240, <span className="font-mono">.RET</span>) e veja, lançamento por lançamento,
          o que já está <b className="text-gray-200">baixado e conciliado</b> no Mega, o que falta <b className="text-gray-200">conciliar</b>,
          o que o banco já pagou ou recebeu e ainda <b className="text-gray-200">não tem baixa</b> — com o título que parece ser — e o que falta <b className="text-gray-200">lançar</b>.
        </p>
      </div>
      <ExtratoBanco />
    </div>
  );
}
