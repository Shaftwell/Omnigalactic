import { describe, expect, it } from 'vitest';
import { deriveSyncStatus } from './syncStatus';

const base = {
  online: true,
  trackedWrites: 0,
  snapshotHasPendingWrites: false,
  hasSnapshotSources: true,
  snapshotFromCache: false,
  checkingPreviousWrites: false,
};

describe('deriveSyncStatus', () => {
  it('only calls a view synced after a server-backed snapshot', () => {
    expect(deriveSyncStatus(base).phase).toBe('synced');
    expect(deriveSyncStatus({ ...base, snapshotFromCache: true }).phase).toBe('connecting');
  });

  it('keeps offline writes labeled as saved locally and waiting', () => {
    const status = deriveSyncStatus({ ...base, online: false, trackedWrites: 2 });
    expect(status.phase).toBe('offline');
    expect(status.label).toContain('2 waiting');
    expect(status.detail).toContain('saved on this device');
  });

  it('reports pending snapshot writes even after a page restart lost the count', () => {
    const status = deriveSyncStatus({ ...base, snapshotHasPendingWrites: true });
    expect(status.phase).toBe('syncing');
    expect(status.hasPendingWrites).toBe(true);
  });

  it('does not claim to be actively syncing while snapshots are cache-only', () => {
    const status = deriveSyncStatus({ ...base, trackedWrites: 1, snapshotFromCache: true });
    expect(status.label).toContain('waiting to sync');
  });
});
