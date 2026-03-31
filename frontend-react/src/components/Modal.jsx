import { useState, useCallback, useRef, useEffect } from 'react';

export default function Modal({ title, wide, children, onClose, onSubmit, customFooter }) {
  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (onSubmit) {
      const fd = new FormData(e.currentTarget);
      // Extract rich text fields
      document.querySelectorAll('.rich-editor[data-field-name]').forEach((editor) => {
        const name = editor.getAttribute('data-field-name');
        const content = editor.querySelector('.rich-content')?.innerHTML?.trim() || '';
        if (content && content !== '<br>' && content !== '<p><br></p>') {
          fd.set(name, content);
        }
      });
      const submitBtn = e.nativeEvent.submitter;
      onSubmit(fd, submitBtn);
    }
    onClose();
  }, [onSubmit, onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={handleOverlayClick}
    >
      <form
        className={`bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} mx-4 max-h-[90vh] overflow-y-auto`}
        onSubmit={handleSubmit}
      >
        <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
        <div className="mb-4">{children}</div>
        {customFooter || (
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition">Annuler</button>
            {onSubmit && <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition">Valider</button>}
          </div>
        )}
      </form>
    </div>
  );
}

export function InputField({ name, label, type = 'text', required = true, value, placeholder, onChange }) {
  return (
    <div className="mb-3">
      <label className="block text-sm text-slate-300 mb-1">{label}</label>
      <input
        name={name} type={type} defaultValue={value} required={required}
        placeholder={placeholder}
        onChange={onChange}
        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none placeholder:text-slate-500"
      />
    </div>
  );
}

export function TextareaField({ name, label, required = false, value }) {
  return (
    <div className="mb-3">
      <label className="block text-sm text-slate-300 mb-1">{label}</label>
      <textarea
        name={name} required={required} rows={2} defaultValue={value || ''}
        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}

export function SelectField({ name, label, options, selected, defaultValue }) {
  return (
    <div className="mb-3">
      <label className="block text-sm text-slate-300 mb-1">{label}</label>
      <select
        name={name} defaultValue={defaultValue ?? selected ?? ''}
        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
      >
        {options?.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function RichTextField({ name, label, value, defaultValue }) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (contentRef.current && !contentRef.current.innerHTML && (value || defaultValue)) {
      const normalized = normalizeForEditor(value || defaultValue);
      contentRef.current.innerHTML = normalized;
    }
  }, [value, defaultValue]);

  return (
    <div className="mb-3">
      <label className="block text-sm text-slate-300 mb-1">{label}</label>
      <div className="rich-editor" data-field-name={name}>
        <div className="rich-toolbar">
          <button type="button" data-cmd="bold" title="Gras (Ctrl+B)" onMouseDown={e => { e.preventDefault(); document.execCommand('bold', false, null); }}><strong>G</strong></button>
          <button type="button" data-cmd="italic" title="Italique (Ctrl+I)" onMouseDown={e => { e.preventDefault(); document.execCommand('italic', false, null); }}><em>I</em></button>
          <button type="button" data-cmd="underline" title="Souligné (Ctrl+U)" onMouseDown={e => { e.preventDefault(); document.execCommand('underline', false, null); }}><u>S</u></button>
          <span className="rich-sep"></span>
          <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList', false, null); }}>• ≡</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('insertOrderedList', false, null); }}>1.</button>
        </div>
        <div
          ref={contentRef}
          className="rich-content"
          contentEditable
          data-placeholder="Saisissez du texte…"
          suppressContentEditableWarning
        />
      </div>
    </div>
  );
}

function normalizeForEditor(val) {
  if (!val) return '';
  try {
    const data = typeof val === 'string' ? JSON.parse(val) : val;
    if (data && typeof data === 'object' && data.blocks) {
      return blocksToHtml(data.blocks);
    }
    if (typeof data === 'string') return data;
  } catch { /* not JSON */ }
  return val;
}

function blocksToHtml(blocks) {
  let html = '';
  blocks.forEach(b => {
    switch (b.type) {
      case 'paragraph': html += '<p>' + (b.data.text || '') + '</p>'; break;
      case 'list': {
        const tag = b.data.style === 'ordered' ? 'ol' : 'ul';
        html += '<' + tag + '>';
        (b.data.items || []).forEach(item => {
          const text = typeof item === 'string' ? item : (item.content || item.text || '');
          html += '<li>' + text + '</li>';
        });
        html += '</' + tag + '>'; break;
      }
      default: if (b.data && b.data.text) html += '<p>' + b.data.text + '</p>';
    }
  });
  return html;
}

export function getRichValue(name) {
  const editor = document.querySelector('.rich-editor[data-field-name="' + name + '"]');
  if (!editor) return '';
  const content = editor.querySelector('.rich-content');
  if (!content) return '';
  const html = content.innerHTML.trim();
  if (!html || html === '<br>' || html === '<p><br></p>') return '';
  return html;
}
