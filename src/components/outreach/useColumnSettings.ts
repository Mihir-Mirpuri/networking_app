'use client';

import { useState, useCallback, useEffect } from 'react';
import { ColumnKey } from './OutreachFilters';

const STORAGE_KEY = 'outreach-column-settings';
const MIN_WIDTH = 60;
const MAX_WIDTH = 500;

// All columns in default order
export const ALL_COLUMNS: ColumnKey[] = [
  'name', 'firm', 'role', 'location', 'group', 'connection',
  'firstEmailDate', 'lastEmailDate', 'followUps', 'response', 'subject', 'notes'
];

// Default visible columns
const DEFAULT_VISIBLE: ColumnKey[] = [
  'name', 'firm', 'role', 'group', 'connection',
  'firstEmailDate', 'lastEmailDate', 'followUps', 'response', 'notes'
];

// Default widths in pixels
const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  name: 200,
  firm: 100,
  role: 120,
  location: 100,
  group: 80,
  connection: 100,
  firstEmailDate: 100,
  lastEmailDate: 100,
  followUps: 80,
  response: 90,
  subject: 200,
  notes: 60,
};

// Column labels for display
export const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: 'Name',
  firm: 'Firm',
  role: 'Role',
  location: 'Location',
  group: 'Group',
  connection: 'Connection',
  firstEmailDate: 'First Email',
  lastEmailDate: 'Last Email',
  followUps: 'Follow-ups',
  response: 'Response?',
  subject: 'Subject',
  notes: 'Notes',
};

interface ColumnSettings {
  order: ColumnKey[];
  visible: ColumnKey[];
  widths: Record<ColumnKey, number>;
}

interface UseColumnSettingsReturn {
  // Ordered list of visible columns
  visibleColumns: ColumnKey[];
  // All columns in current order (for the dropdown)
  columnOrder: ColumnKey[];
  // Column widths
  widths: Record<ColumnKey, number>;
  // Toggle column visibility
  toggleColumn: (column: ColumnKey) => void;
  // Check if column is visible
  isVisible: (column: ColumnKey) => boolean;
  // Reorder columns (move from one index to another)
  reorderColumns: (fromIndex: number, toIndex: number) => void;
  // Resize column
  startResize: (column: ColumnKey, startX: number) => void;
  // Auto-fit column width
  autoFitColumn: (column: ColumnKey, contentWidths: number[]) => void;
  // Reset to defaults
  resetToDefaults: () => void;
}

export function useColumnSettings(): UseColumnSettingsReturn {
  const [settings, setSettings] = useState<ColumnSettings>({
    order: ALL_COLUMNS,
    visible: DEFAULT_VISIBLE,
    widths: DEFAULT_WIDTHS,
  });

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ColumnSettings>;
        setSettings((prev) => ({
          order: parsed.order && parsed.order.length === ALL_COLUMNS.length
            ? parsed.order
            : prev.order,
          visible: parsed.visible || prev.visible,
          widths: { ...DEFAULT_WIDTHS, ...parsed.widths },
        }));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save to localStorage when settings change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage errors
    }
  }, [settings]);

  // Get visible columns in current order
  const visibleColumns = settings.order.filter((col) => settings.visible.includes(col));

  const toggleColumn = useCallback((column: ColumnKey) => {
    setSettings((prev) => {
      const isCurrentlyVisible = prev.visible.includes(column);
      // Don't allow removing all columns
      if (isCurrentlyVisible && prev.visible.length <= 1) {
        return prev;
      }
      return {
        ...prev,
        visible: isCurrentlyVisible
          ? prev.visible.filter((c) => c !== column)
          : [...prev.visible, column],
      };
    });
  }, []);

  const isVisible = useCallback((column: ColumnKey) => {
    return settings.visible.includes(column);
  }, [settings.visible]);

  const reorderColumns = useCallback((fromIndex: number, toIndex: number) => {
    setSettings((prev) => {
      const newOrder = [...prev.order];
      const [moved] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, moved);
      return { ...prev, order: newOrder };
    });
  }, []);

  const startResize = useCallback((column: ColumnKey, startX: number) => {
    const startWidth = settings.widths[column];

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));

      setSettings((prev) => ({
        ...prev,
        widths: { ...prev.widths, [column]: newWidth },
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [settings.widths]);

  const autoFitColumn = useCallback((column: ColumnKey, contentWidths: number[]) => {
    if (contentWidths.length === 0) return;

    const maxContent = Math.max(...contentWidths);
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, maxContent + 24));

    setSettings((prev) => ({
      ...prev,
      widths: { ...prev.widths, [column]: newWidth },
    }));
  }, []);

  const resetToDefaults = useCallback(() => {
    setSettings({
      order: ALL_COLUMNS,
      visible: DEFAULT_VISIBLE,
      widths: DEFAULT_WIDTHS,
    });
  }, []);

  return {
    visibleColumns,
    columnOrder: settings.order,
    widths: settings.widths,
    toggleColumn,
    isVisible,
    reorderColumns,
    startResize,
    autoFitColumn,
    resetToDefaults,
  };
}
