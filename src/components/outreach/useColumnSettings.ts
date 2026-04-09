'use client';

import { useState, useCallback, useEffect } from 'react';
import { ColumnKey, BuiltInColumnKey } from './OutreachFilters';

const STORAGE_KEY = 'outreach-column-settings';
const CUSTOM_DATA_KEY = 'outreach-custom-column-data';
const MIN_WIDTH = 60;
const MAX_WIDTH = 500;

// All built-in columns in default order
export const ALL_COLUMNS: BuiltInColumnKey[] = [
  'name', 'firm', 'role', 'location', 'group', 'connection',
  'firstEmailDate', 'lastEmailDate', 'followUps', 'response', 'subject', 'notes'
];

// Default visible columns
const DEFAULT_VISIBLE: ColumnKey[] = [
  'name', 'firm', 'role', 'group', 'connection',
  'firstEmailDate', 'lastEmailDate', 'followUps', 'response', 'notes'
];

// Default widths in pixels
const DEFAULT_WIDTHS: Record<string, number> = {
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

// Built-in column labels
const BUILT_IN_LABELS: Record<BuiltInColumnKey, string> = {
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

// Re-export for backwards compat
export const COLUMN_LABELS = BUILT_IN_LABELS;

interface CustomColumn {
  key: string;
  label: string;
}

interface ColumnSettings {
  order: ColumnKey[];
  visible: ColumnKey[];
  widths: Record<string, number>;
  customColumns: CustomColumn[];
}

// Custom column data: trackerId -> columnKey -> value
type CustomColumnData = Record<string, Record<string, string>>;

interface UseColumnSettingsReturn {
  visibleColumns: ColumnKey[];
  columnOrder: ColumnKey[];
  widths: Record<string, number>;
  toggleColumn: (column: ColumnKey) => void;
  isVisible: (column: ColumnKey) => boolean;
  reorderColumns: (fromIndex: number, toIndex: number) => void;
  startResize: (column: ColumnKey, startX: number) => void;
  autoFitColumn: (column: ColumnKey, contentWidths: number[]) => void;
  autoFitAllColumns: (tableRef: React.RefObject<HTMLDivElement | null>) => void;
  resetToDefaults: () => void;
  // Labels
  getColumnLabel: (column: ColumnKey) => string;
  allColumnLabels: Record<string, string>;
  // Custom columns
  customColumns: CustomColumn[];
  addCustomColumn: (label: string) => void;
  removeCustomColumn: (key: string) => void;
  renameCustomColumn: (key: string, newLabel: string) => void;
  // Custom column data
  getCustomCellValue: (trackerId: string, columnKey: string) => string;
  setCustomCellValue: (trackerId: string, columnKey: string, value: string) => void;
}

function loadSettings(): ColumnSettings {
  const defaults: ColumnSettings = {
    order: ALL_COLUMNS as ColumnKey[],
    visible: DEFAULT_VISIBLE,
    widths: DEFAULT_WIDTHS,
    customColumns: [],
  };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaults;
    const parsed = JSON.parse(saved) as Partial<ColumnSettings>;
    const customCols = parsed.customColumns || [];
    const allKeys: ColumnKey[] = [...ALL_COLUMNS, ...customCols.map(c => c.key)];
    // Merge saved order with all known keys — keep saved order, append any missing keys
    let order: ColumnKey[];
    if (parsed.order && Array.isArray(parsed.order)) {
      const savedOrder = parsed.order.filter((k: string) => allKeys.includes(k));
      const missing = allKeys.filter(k => !savedOrder.includes(k));
      order = [...savedOrder, ...missing];
    } else {
      order = allKeys;
    }
    return {
      order,
      visible: parsed.visible && Array.isArray(parsed.visible) ? parsed.visible : defaults.visible,
      widths: { ...DEFAULT_WIDTHS, ...parsed.widths },
      customColumns: customCols,
    };
  } catch {
    return defaults;
  }
}

function loadCustomData(): CustomColumnData {
  try {
    const saved = localStorage.getItem(CUSTOM_DATA_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Ignore
  }
  return {};
}

export function useColumnSettings(): UseColumnSettingsReturn {
  const [settings, setSettings] = useState<ColumnSettings>(loadSettings);
  const [customData, setCustomData] = useState<CustomColumnData>(loadCustomData);

  // Save to localStorage when settings change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage errors
    }
  }, [settings]);

  // Save custom data to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_DATA_KEY, JSON.stringify(customData));
    } catch {
      // Ignore
    }
  }, [customData]);

  const visibleColumns = settings.order.filter((col) => settings.visible.includes(col));

  const toggleColumn = useCallback((column: ColumnKey) => {
    setSettings((prev) => {
      const isCurrentlyVisible = prev.visible.includes(column);
      if (isCurrentlyVisible && prev.visible.length <= 1) return prev;
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
    const startWidth = settings.widths[column] || 100;

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

  const autoFitAllColumns = useCallback((tableRef: React.RefObject<HTMLDivElement | null>) => {
    if (!tableRef.current) return;
    const currentVisible = settings.order.filter((col) => settings.visible.includes(col));
    if (currentVisible.length === 0) return;

    // Get available width: table width minus star column (40px) and delete column (40px) and padding (32px)
    const tableWidth = tableRef.current.clientWidth;
    const reservedWidth = 40 + 40 + 32;
    const availableWidth = tableWidth - reservedWidth;

    // Distribute available width evenly, clamped to min/max
    const perColumn = Math.floor(availableWidth / currentVisible.length);
    const clampedWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, perColumn));

    const newWidths = { ...settings.widths };
    for (const col of currentVisible) {
      newWidths[col] = clampedWidth;
    }

    setSettings((prev) => ({ ...prev, widths: newWidths }));
  }, [settings.order, settings.visible, settings.widths]);

  const resetToDefaults = useCallback(() => {
    setSettings({
      order: ALL_COLUMNS as ColumnKey[],
      visible: DEFAULT_VISIBLE,
      widths: DEFAULT_WIDTHS,
      customColumns: [],
    });
  }, []);

  // Column labels
  const getColumnLabel = useCallback((column: ColumnKey): string => {
    if (column in BUILT_IN_LABELS) {
      return BUILT_IN_LABELS[column as BuiltInColumnKey];
    }
    const custom = settings.customColumns.find((c) => c.key === column);
    return custom?.label || column;
  }, [settings.customColumns]);

  const allColumnLabels: Record<string, string> = {
    ...BUILT_IN_LABELS,
    ...Object.fromEntries(settings.customColumns.map((c) => [c.key, c.label])),
  };

  // Custom columns management
  const addCustomColumn = useCallback((label: string) => {
    const key = `custom_${Date.now()}`;
    setSettings((prev) => ({
      ...prev,
      order: [...prev.order, key],
      visible: [...prev.visible, key],
      widths: { ...prev.widths, [key]: 120 },
      customColumns: [...prev.customColumns, { key, label }],
    }));
  }, []);

  const removeCustomColumn = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      order: prev.order.filter((c) => c !== key),
      visible: prev.visible.filter((c) => c !== key),
      customColumns: prev.customColumns.filter((c) => c.key !== key),
    }));
    // Clean up data
    setCustomData((prev) => {
      const next = { ...prev };
      for (const trackerId of Object.keys(next)) {
        if (next[trackerId][key]) {
          const row = { ...next[trackerId] };
          delete row[key];
          next[trackerId] = row;
        }
      }
      return next;
    });
  }, []);

  const renameCustomColumn = useCallback((key: string, newLabel: string) => {
    setSettings((prev) => ({
      ...prev,
      customColumns: prev.customColumns.map((c) =>
        c.key === key ? { ...c, label: newLabel } : c
      ),
    }));
  }, []);

  // Custom column cell data
  const getCustomCellValue = useCallback((trackerId: string, columnKey: string): string => {
    return customData[trackerId]?.[columnKey] || '';
  }, [customData]);

  const setCustomCellValue = useCallback((trackerId: string, columnKey: string, value: string) => {
    setCustomData((prev) => ({
      ...prev,
      [trackerId]: {
        ...(prev[trackerId] || {}),
        [columnKey]: value,
      },
    }));
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
    autoFitAllColumns,
    resetToDefaults,
    getColumnLabel,
    allColumnLabels,
    customColumns: settings.customColumns,
    addCustomColumn,
    removeCustomColumn,
    renameCustomColumn,
    getCustomCellValue,
    setCustomCellValue,
  };
}
