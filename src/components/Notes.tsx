import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Plus, Trash2 } from 'lucide-react';
import { addItem, deleteItem, updateItem, watchItems, type Item } from '../lib/items';

interface Props {
  siteId: string;
  user: User;
}

export default function Notes({ siteId, user }: Props) {
  const [notes, setNotes] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => watchItems(siteId, 'notes', setNotes), [siteId]);

  const selected = notes.find(n => n.id === selectedId) ?? null;

  const handleCreate = async () => {
    const ref = await addItem(siteId, 'notes', {
      text: 'Untitled note',
      body: '',
      createdByEmail: user.email ?? '',
    });
    setSelectedId(ref.id);
  };

  return (
    <div className="max-w-3xl mx-auto grid md:grid-cols-[240px_1fr] gap-4">
      <div className="flex flex-col gap-2">
        <button
          onClick={handleCreate}
          className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 font-medium"
        >
          <Plus className="w-4 h-4" /> New note
        </button>
        {notes.map(note => (
          <button
            key={note.id}
            onClick={() => setSelectedId(note.id)}
            className={`text-left rounded-xl px-4 py-2.5 truncate transition-colors ${
              note.id === selectedId ? 'bg-white/15' : 'bg-white/5 hover:bg-white/10'
            }`}
          >
            {note.text || 'Untitled note'}
          </button>
        ))}
      </div>
      {selected ? (
        <div className="flex flex-col gap-2 bg-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <input
              value={selected.text}
              onChange={e => updateItem(siteId, 'notes', selected.id, { text: e.target.value })}
              className="flex-1 bg-transparent text-lg font-semibold outline-none"
              placeholder="Title"
            />
            <button
              onClick={() => {
                deleteItem(siteId, 'notes', selected.id);
                setSelectedId(null);
              }}
              className="text-gray-500 hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <textarea
            value={selected.body ?? ''}
            onChange={e => updateItem(siteId, 'notes', selected.id, { body: e.target.value })}
            className="flex-1 min-h-[40vh] bg-transparent outline-none resize-none text-gray-200"
            placeholder="Write anything…"
          />
        </div>
      ) : (
        <p className="text-gray-500 text-sm self-center text-center">Select or create a note.</p>
      )}
    </div>
  );
}
