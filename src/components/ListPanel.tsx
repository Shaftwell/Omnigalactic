import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Check, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { addItem, deleteItem, updateItem, watchItems, type Item, type Kind } from '../lib/items';

interface Props {
  siteId: string;
  kind: Extract<Kind, 'tasks' | 'shopping'>;
  user: User;
  placeholder: string;
}

// Shared checklist UI used by both the Tasks and Shopping tabs.
export default function ListPanel({ siteId, kind, user, placeholder }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');

  useEffect(() => watchItems(siteId, kind, setItems), [siteId, kind]);

  const handleAdd = () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    addItem(siteId, kind, { text: value, done: false, createdByEmail: user.email ?? '' });
  };

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          className="flex-1 bg-white/5 rounded-xl px-4 py-3 outline-none focus:ring-2 ring-indigo-500 placeholder:text-gray-500"
        />
        <button onClick={handleAdd} className="px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500">
          <Plus className="w-5 h-5" />
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map(item => (
          <li key={item.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 group">
            <button
              onClick={() => updateItem(siteId, kind, item.id, { done: !item.done })}
              className={clsx(
                'w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                item.done ? 'bg-emerald-500 border-emerald-500' : 'border-gray-500 hover:border-emerald-400',
              )}
            >
              {item.done && <Check className="w-4 h-4 text-white" />}
            </button>
            <span className={clsx('flex-1', item.done && 'line-through text-gray-500')}>{item.text}</span>
            <button
              onClick={() => deleteItem(siteId, kind, item.id)}
              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
        {items.length === 0 && <p className="text-gray-500 text-sm text-center py-6">Nothing here yet.</p>}
      </ul>
    </div>
  );
}
