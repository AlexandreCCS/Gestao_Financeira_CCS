// [01/07/2026 - Alexandre Carvalho] Multi-select searchable com checkboxes.
// value=array de ids | onChange(array) | options=[{id,nome}] | allLabel = rotulo quando vazio.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, X, Search, Check } from 'lucide-react';

const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function MultiSelect({ value = [], onChange, options = [], placeholder = 'Buscar...', allLabel = 'Todas' }) {
  const [open, setOpen]   = useState(false);
  const [busca, setBusca] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const filtradas = useMemo(() => {
    if (!busca.trim()) return options;
    const q = norm(busca);
    return options.filter(o => norm(`${o.id} ${o.nome}`).includes(q));
  }, [busca, options]);

  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  const sel = value.length;
  const display = sel === 0 ? allLabel : `${sel} selecionada${sel > 1 ? 's' : ''}`;

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          className="input mt-1 w-full pr-16"
          value={open ? busca : display}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setBusca(''); }}
          onChange={e => { setBusca(e.target.value); setOpen(true); }}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {sel > 0 && (
            <button type="button" title="Limpar" onClick={e => { e.stopPropagation(); onChange([]); setBusca(''); }}
              className="p-0.5 rounded hover:bg-ink-700 text-gray-400 hover:text-white"><X size={14} /></button>
          )}
          <ChevronDown size={14} className={`text-gray-400 transition ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto card border border-ink-700 shadow-xl">
          {filtradas.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500 italic"><Search size={12} className="inline mr-1" /> Nada encontrado</div>
          ) : filtradas.map(o => {
            const on = value.includes(o.id);
            return (
              <button key={o.id} type="button" onClick={() => toggle(o.id)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-prim-600/40 ${on ? 'bg-ink-800 text-prim-300' : 'text-gray-200'}`}>
                <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-prim-600 border-prim-600' : 'border-ink-600'}`}>
                  {on && <Check size={12} className="text-white" />}
                </span>
                <span className="text-gray-500 font-mono text-xs">{o.id}</span>
                <span className="truncate">{o.nome}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
