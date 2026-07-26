import React, { useState, useEffect } from 'react';
import { ShoppingBag, Plus, Trash2, CheckCircle2, Circle, ShoppingCart, Tag, Filter, X, ChevronDown, ChevronRight } from 'lucide-react';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { ShoppingItem } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { clearSnapshotMetadata, reportSnapshotMetadata, trackWrite } from '../lib/syncStatus';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const STORE_CONFIG: Record<string, { color: string, logo: string, bg: string, border: string }> = {
  'Aldi': {
    color: 'text-blue-400',
    bg: 'bg-blue-900/30',
    border: 'border-blue-800/50',
    logo: 'https://www.google.com/s2/favicons?domain=aldi.us&sz=128'
  },
  'Publix': {
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/30',
    border: 'border-emerald-800/50',
    logo: 'https://www.google.com/s2/favicons?domain=publix.com&sz=128'
  },
  'Costco': {
    color: 'text-red-400',
    bg: 'bg-red-900/30',
    border: 'border-red-800/50',
    logo: 'https://www.google.com/s2/favicons?domain=costco.com&sz=128'
  },
  'Sprouts': {
    color: 'text-lime-400',
    bg: 'bg-lime-900/30',
    border: 'border-lime-800/50',
    logo: 'https://www.google.com/s2/favicons?domain=sprouts.com&sz=128'
  },
  'Walmart': {
    color: 'text-sky-400',
    bg: 'bg-sky-900/30',
    border: 'border-sky-800/50',
    logo: 'https://www.google.com/s2/favicons?domain=walmart.com&sz=128'
  },
  "Trader Joe's": {
    color: 'text-rose-400',
    bg: 'bg-rose-900/30',
    border: 'border-rose-800/50',
    logo: 'https://www.google.com/s2/favicons?domain=traderjoes.com&sz=128'
  }
};

const CATEGORIES = ['Aldi', 'Publix', 'Costco', 'Sprouts', 'Walmart', "Trader Joe's"];
const DEFAULT_CATEGORY = "Trader Joe's";

// Items saved before the rename carry category 'Other'
const normalizeCategory = (category: string | undefined): string =>
  !category || category === 'Other' ? DEFAULT_CATEGORY : category;

export default function ShoppingList() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItem, setNewItem] = useState({ name: '', category: DEFAULT_CATEGORY });
  const [filter, setFilter] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAcquired, setShowAcquired] = useState(false);

  useEffect(() => {
    if (auth.currentUser) {
      console.log("Current user email:", auth.currentUser.email);
    }
    const q = query(collection(userRoot(), 'shoppingItems'), orderBy('createdAt', 'desc'));
    const source = 'shopping-list';
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      reportSnapshotMetadata(source, snapshot.metadata);
      const itemList = snapshot.docs.map(doc => {
        const data = doc.data();
        return { id: doc.id, ...data, category: normalizeCategory(data.category) } as ShoppingItem;
      });
      setItems(itemList);
      setError(null);
    }, (err) => {
      clearSnapshotMetadata(source);
      console.error("Firestore onSnapshot error:", err);
      setError("Failed to load items. You might not have permission.");
      try {
        handleFirestoreError(err, OperationType.LIST, 'shoppingItems');
      } catch (e) {
        // handleFirestoreError throws, we already set the error state
      }
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, []);

  // Writes are local-first: with the persistent cache the doc is saved
  // on-device the moment the write is issued and syncs when back online.
  // Never await the server ack in the UI — offline it never arrives, and
  // awaiting it used to freeze this modal on a spinner inside the store.
  // Real rejections (permission/validation) still surface via .catch.
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !newItem.name.trim()) return;

    setError(null);
    trackWrite(addDoc(collection(userRoot(), 'shoppingItems'), {
      ...newItem,
      isBought: false,
      createdBy: auth.currentUser.uid,
      authorName: auth.currentUser.displayName || 'Explorer',
      createdAt: new Date().toISOString()
    })).catch((err: any) => {
      console.error("Failed to add item:", err);
      setError(err?.code === 'permission-denied' || err?.message?.includes('permission-denied')
        ? "Permission denied. You might not be authorized to add items."
        : "Failed to add item. Please check your connection and try again.");
    });
    setNewItem({ name: '', category: DEFAULT_CATEGORY });
    setIsModalOpen(false);
  };

  const toggleBought = (item: ShoppingItem) => {
    trackWrite(updateDoc(doc(userRoot(), 'shoppingItems', item.id!), {
      isBought: !item.isBought
    })).catch(err => {
      console.error("Failed to update item:", err);
      setError("Failed to update item. You might not have permission.");
    });
  };

  const handleDeleteItem = (id: string) => {
    trackWrite(deleteDoc(doc(userRoot(), 'shoppingItems', id))).catch(err => {
      console.error("Failed to delete item:", err);
      setError("Failed to delete item. You might not have permission.");
    });
  };

  const filteredItems = filter ? items.filter(item => item.category === filter) : items;
  const boughtItems = filteredItems.filter(item => item.isBought);
  const pendingItems = filteredItems.filter(item => !item.isBought);

  // Group pending items by category
  const groupedPendingItems = pendingItems.reduce((acc, item) => {
    const cat = normalizeCategory(item.category);
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>);

  // Sort categories so they appear consistently (CATEGORIES order)
  const sortedCategories = Object.keys(groupedPendingItems).sort((a, b) => {
    const indexA = CATEGORIES.indexOf(a);
    const indexB = CATEGORIES.indexOf(b);
    return (indexA > -1 ? indexA : 99) - (indexB > -1 ? indexB : 99);
  });

  return (
    <div className="flex flex-col h-full overflow-hidden text-slate-200">
      {/* Header */}
      <header className="bg-slate-900/60 backdrop-blur-xl px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3 border-b border-slate-800/60 sticky top-0 z-10">
        <h1 className="flex items-center min-w-0">
          <ShoppingCart className="text-emerald-400 w-6 h-6 shrink-0" />
          <span className="sr-only">Shopping List</span>
        </h1>
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <span className="text-xs font-bold text-emerald-400 bg-emerald-900/30 px-2.5 py-1 rounded-full border border-emerald-800/50 whitespace-nowrap">
            {pendingItems.length}<span className="hidden md:inline"> items</span> needed
          </span>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-emerald-600 text-white px-3 md:px-4 py-2 rounded-xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-900/20 flex items-center gap-1.5 text-sm font-bold whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add<span className="hidden md:inline"> Item</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {error && !isModalOpen && (
          <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm font-medium">
            {error}
          </div>
        )}
        {/* Category Filters */}
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          <button 
            onClick={() => setFilter(null)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all",
              filter === null ? "bg-emerald-600 text-white shadow-md" : "bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800"
            )}
          >
            All Supplies
          </button>
          {CATEGORIES.map(cat => {
            const config = STORE_CONFIG[cat];
            return (
              <button 
                key={cat}
                onClick={() => setFilter(cat)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2",
                  filter === cat ? "bg-emerald-600 text-white shadow-md" : "bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800"
                )}
              >
                {config.logo && (
                  <div className="w-5 h-5 rounded-sm flex items-center justify-center overflow-hidden p-0.5">
                    <img src={config.logo} alt={cat} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                  </div>
                )}
                {cat}
              </button>
            );
          })}
        </div>

        {/* List Sections */}
        <div className="space-y-8">
          {/* Pending Items */}
          <section className="space-y-6">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-2">To Acquire</h2>
            <div className="space-y-8">
              {pendingItems.length === 0 ? (
                <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-8 text-center">
                  <p className="text-slate-500 text-sm">Inventory is fully stocked!</p>
                </div>
              ) : (
                sortedCategories.map(category => {
                  const config = STORE_CONFIG[category] || STORE_CONFIG[DEFAULT_CATEGORY];
                  return (
                    <div key={category} className="space-y-3">
                      <div className="flex items-center gap-2 px-2">
                        {config.logo && (
                          <div className="w-6 h-6 rounded-md flex items-center justify-center overflow-hidden p-0.5">
                            <img 
                              src={config.logo} 
                              alt={category} 
                              className="w-full h-full object-contain" 
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                        <h3 className={cn(
                          "text-sm font-bold uppercase tracking-wider",
                          config.color
                        )}>
                          {category}
                        </h3>
                        <div className="h-px flex-1 bg-slate-800 ml-2" />
                      </div>
                      
                      <div className="space-y-2">
                        {groupedPendingItems[category].map(item => {
                          const itemConfig = STORE_CONFIG[item.category] || STORE_CONFIG[DEFAULT_CATEGORY];
                          return (
                            <motion.div 
                              layout
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              key={item.id} 
                              className="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-sm flex items-center justify-between group"
                            >
                              <div className="flex items-center gap-4 flex-1">
                                <button onClick={() => toggleBought(item)} className="text-slate-600 hover:text-emerald-400 transition-colors">
                                  <Circle className="w-6 h-6" />
                                </button>
                                
                                {/* Large Store Logo */}
                                {itemConfig.logo && (
                                  <div className="w-12 h-12 flex-shrink-0 rounded-xl flex items-center justify-center p-2 border border-slate-800 shadow-inner overflow-hidden">
                                    <img 
                                      src={itemConfig.logo} 
                                      alt={item.category} 
                                      className="w-full h-full object-contain" 
                                      referrerPolicy="no-referrer"
                                    />
                                  </div>
                                )}

                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-white text-lg">{item.name}</h3>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-slate-500">Logged by {item.authorName}</span>
                                  </div>
                                </div>
                              </div>
                              <button 
                                onClick={() => handleDeleteItem(item.id!)}
                                className="p-2 text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Bought Items */}
          {boughtItems.length > 0 && (
            <section className="space-y-3">
              <button 
                onClick={() => setShowAcquired(!showAcquired)}
                className="flex items-center gap-2 px-2 group"
              >
                {showAcquired ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest group-hover:text-slate-400 transition-colors">Acquired ({boughtItems.length})</h2>
              </button>
              
              <AnimatePresence>
                {showAcquired && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-2"
                  >
                    <div className="space-y-2 opacity-60 pt-1">
                      {boughtItems.map(item => (
                        <motion.div 
                          layout
                          key={item.id} 
                          className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex items-center justify-between group"
                        >
                          <div className="flex items-center gap-4 flex-1">
                            <button onClick={() => toggleBought(item)} className="text-emerald-500">
                              <CheckCircle2 className="w-6 h-6" />
                            </button>
                            <div className="flex-1">
                              <h3 className="font-bold text-slate-600 line-through">{item.name}</h3>
                              <div className="flex items-center gap-1 mt-1">
                                {(() => {
                                  const itemConfig = STORE_CONFIG[item.category] || STORE_CONFIG[DEFAULT_CATEGORY];
                                  return (
                                    <>
                                      {itemConfig.logo && (
                                        <img 
                                          src={itemConfig.logo} 
                                          alt={item.category} 
                                          className="w-3 h-3 rounded-sm grayscale opacity-50" 
                                          referrerPolicy="no-referrer"
                                        />
                                      )}
                                      <p className="text-[10px] text-slate-700 uppercase tracking-wider font-bold">{item.category}</p>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                          <button 
                            onClick={() => handleDeleteItem(item.id!)}
                            className="p-2 text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}
        </div>
      </div>

      {/* Add Item Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-slate-900 rounded-3xl shadow-2xl border border-slate-800 p-6 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Plus className="text-emerald-400 w-5 h-5" />
                  Request Supplies
                </h2>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-500 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm font-medium">
                  {error}
                </div>
              )}

              <form onSubmit={handleAddItem} className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="shopping-item-name" className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Item Name</label>
                    <input
                      id="shopping-item-name"
                      autoFocus
                      type="text"
                      maxLength={199}
                      placeholder="e.g. Blue Milk, Power Cells"
                      className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 transition-all"
                      value={newItem.name}
                      onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Store / Category</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {CATEGORIES.map(cat => {
                        const config = STORE_CONFIG[cat];
                        const isSelected = newItem.category === cat;
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setNewItem({ ...newItem, category: cat })}
                            className={cn(
                              "flex items-center gap-2 p-3 rounded-xl border transition-all text-sm font-medium",
                              isSelected
                                ? "bg-emerald-900/30 border-emerald-500 text-emerald-400 shadow-lg shadow-emerald-900/20"
                                : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                            )}
                          >
                            {config.logo && (
                              <div className="w-5 h-5 rounded-sm flex items-center justify-center overflow-hidden p-0.5">
                                <img src={config.logo} alt={cat} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                              </div>
                            )}
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-6 py-3 rounded-xl text-slate-400 font-bold hover:bg-slate-800 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newItem.name.trim()}
                    className="flex-[2] bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    Add to List
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
