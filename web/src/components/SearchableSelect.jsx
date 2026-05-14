// [08/05/2026 - CRIADO POR Alexandre Carvalho] Combo searchable: input com dropdown
// filtrado por digito. Substitui <select> tradicional quando a lista e grande (50+ itens).
// Props:
//   value     -> valor atual (id) | 0 = "Todas" / null = vazio
//   onChange  -> callback (id) | 0 quando limpar
//   options   -> array [{id, nome}]
//   placeholder
//   allLabel  -> rotulo da opcao "(Todas)" - default '(Todas)'. Passar null pra esconder.
//   className
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';

const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');

export default function SearchableSelect({ value, onChange, options = [], placeholder = 'Buscar...', allLabel = '(Todas)', className = '' }) {
  const [open, setOpen]   = useState(false);
  const [busca, setBusca] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Fecha ao clicar fora
  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Esc fecha
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const selecionado = useMemo(
    () => (value === 0 || value == null) ? null : options.find(o => o.id === value),
    [value, options]
  );

  const filtradas = useMemo(() => {
    if (!busca.trim()) return options;
    const q = norm(busca);
    return options.filter(o => norm(`${o.id} ${o.nome}`).includes(q));
  }, [busca, options]);

  function selecionar(id) {
    onChange(id);
    setBusca('');
    setOpen(false);
  }

  // Texto exibido no input quando fechado
  const display = !open
    ? (selecionado ? `${selecionado.id} - ${selecionado.nome}` : (allLabel || ''))
    : busca;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className="input mt-1 w-full pr-16"
          value={display}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setBusca(''); }}
          onChange={e => { setBusca(e.target.value); if (!open) setOpen(true); }}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {selecionado && (
            <button type="button"
                    title="Limpar"
                    onClick={(e) => { e.stopPropagation(); onChange(0); setBusca(''); setOpen(false); }}
                    className="p-0.5 rounded hover:bg-ink-700 text-gray-400 hover:text-white">
              <X size={14}/>
            </button>
          )}
          <ChevronDown size={14} className={`text-gray-400 transition ${open ? 'rotate-180' : ''}`}/>
        </div>
      </div>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto card border border-ink-700 shadow-xl">
          {allLabel && (
            <button type="button"
                    onClick={() => selecionar(0)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-prim-600 hover:text-white
                                ${value === 0 ? 'bg-ink-800 text-prim-300' : 'text-gray-200'}`}>
              {allLabel}
            </button>
          )}
          {filtradas.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500 italic">
              <Search size={12} className="inline mr-1"/> Nada encontrado
            </div>
          ) : filtradas.map(o => (
            <button key={o.id} type="button"
                    onClick={() => selecionar(o.id)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-prim-600 hover:text-white
                                ${o.id === value ? 'bg-ink-800 text-prim-300' : 'text-gray-200'}`}>
              <span className="text-gray-500 mr-2 font-mono text-xs">{o.id}</span>
              {o.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
