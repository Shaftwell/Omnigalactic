export type TimeFormat = 'standard' | 'military';

// A service provider (plumber, electrician, HVAC, ...).
export interface Vendor {
  id?: string;
  name: string; // 1..200
  serviceType: string; // 1..100, e.g. "Plumbing" (grouping key)
  phone?: string; // 1..50
  email?: string; // valid email when present
  website?: string; // 1..500, client normalizes to https://
  notes?: string; // <= 5000
  createdBy: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
}

// A documented purchase (appliance, etc.) with optional warranty tracking and
// an optional link to a Vendor in the directory.
export interface Purchase {
  id?: string;
  itemName: string; // 1..200
  vendorId?: string; // optional link to a Vendor doc id, 1..64
  purchasedFrom?: string; // <= 200 free text (used when no vendor is linked)
  purchaseDate: string; // date-only YYYY-MM-DD
  price?: number; // 0..1e12
  warrantyExpires?: string; // date-only YYYY-MM-DD
  notes?: string; // <= 5000
  createdBy: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
}

// Read-only metadata for an uploaded document (warranty, invoice, receipt).
// Lives in vendors/{id}/files/{fileId} or purchases/{id}/files/{fileId}. The
// bytes live in Cloud Storage; both the object and this doc are written and
// deleted only by the /api/files Cloud Function, so clients never mutate them.
export interface AttachmentMeta {
  id?: string;
  fileName: string; // 1..300 display name
  storagePath: string; // familyFiles/{parentType}/{parentId}/{fileId}
  contentType: string; // whitelisted type
  size: number; // 1..10485760 bytes
  label?: string; // <= 200 optional
  createdBy: string;
  authorName: string;
  createdAt: string;
}

// Whether a budget category counts against spending or toward income. Net is
// income minus expenses. Absent on categories created before income existed;
// readers treat a missing kind as 'expense'.
export type BudgetKind = 'expense' | 'income';

// A user-managed budget category (e.g. "Transportation" or "Salary").
// Categories group subcategories; both are added and deleted from the UI, no
// database access needed. Household-shared like the shopping list.
export interface BudgetCategory {
  id?: string;
  name: string; // 1..100
  kind?: BudgetKind; // 'expense' when absent
  sortOrder: number; // display order, 0..100000
  createdBy: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
}

// A budget line inside a category (e.g. "Car payment"), with a planned monthly
// amount in USD. References its parent BudgetCategory by document id.
export interface BudgetSubcategory {
  id?: string;
  categoryId: string; // parent BudgetCategory doc id, 1..64
  name: string; // 1..100
  amount: number; // planned monthly USD, 0..1e12
  sortOrder: number;
  createdBy: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
}

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'bi-monthly' | 'semi-annually' | 'annually';

export interface Event {
  id?: string;
  title: string;
  description: string;
  date: string; // ISO string
  createdBy: string;
  authorName: string;
  createdAt: string;
  recurrence?: RecurrenceType;
  color?: string; // palette name, see lib/eventColors
  location?: string;
  updatedAt?: string;
}

export interface ShoppingItem {
  id?: string;
  name: string;
  isBought: boolean;
  category: string;
  createdBy: string;
  authorName: string;
  createdAt: string;
}

export interface Note {
  id?: string;
  title: string;
  content: string; // markdown (legacy notes may contain Quill HTML, converted on open)
  color?: string;
  createdBy: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface List {
  id?: string;
  title: string;
  items: string[]; // legacy plain items; migrated into person-assigned tasks
  color?: string;
  createdBy: string;
  authorName: string;
  createdAt: string;
}

export type PriceSource = 'live' | 'manual';
export type AssetType = 'market' | 'cash' | 'home' | 'car';

export interface AssetClassDefinition {
  id: string; // Firestore document ID and permanent identity used by holdings
  name: string;
  normalizedName: string; // canonical uniqueness key
  isDefault: boolean;
  sortOrder: number;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Holding {
  id?: string;
  symbol: string; // TradingView format "EXCHANGE:TICKER" (or bare ticker), stored uppercase
  name?: string;
  assetType?: AssetType; // absent on legacy documents; treated as "market"
  // Legacy classification retained so older cached clients and queued offline
  // writes remain valid. Current clients save the canonical asset class here.
  category?: string;
  // The single portfolio-wide classification. Optional for legacy documents;
  // readers fall back to a meaningful `category` value or a type default.
  assetClass?: string;
  // Permanent reference to /portfolios/household/assetClasses/{assetClassId}.
  // Optional while legacy/offline documents are migrated.
  assetClassId?: string;
  quantity: number;
  price: number; // last known price per unit; 0 until first quote or manual entry
  priceUpdatedAt?: string;
  priceSource?: PriceSource;
  targetPct: number; // desired share of total portfolio value, 0..100
  createdBy: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PortfolioSettings {
  driftThresholdPct: number; // flag holdings whose |actual - target| exceeds this
  autoRefresh: boolean;
  refreshSec: number;
  updatedAt?: string;
}

// A per-account label for who a task is for; the list is user-managed.
export type Person = string;

export interface Task {
  id?: string;
  title: string;
  assignee: string; // person name; blank is displayed as the default person
  isCompleted: boolean;
  listId?: string | null; // null/absent = Inbox
  notes?: string;
  dueDate?: string | null; // yyyy-MM-dd (Eastern)
  repeat?: string; // TaskRepeat; repeating tasks reschedule on completion
  lastCompletedAt?: string;
  completedAt?: string;
  createdBy: string;
  authorName: string;
  createdAt: string;
}
