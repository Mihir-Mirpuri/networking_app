'use client';

import { useState, useMemo } from 'react';
import { Combobox } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';

type ComboboxOption = string | { label: string; value: string };

interface SearchableComboboxProps {
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  allowFreeText?: boolean;
}

export function SearchableCombobox({
  options,
  value,
  onChange,
  label,
  placeholder = 'Search...',
  id,
  disabled = false,
  allowFreeText = false,
}: SearchableComboboxProps) {
  const [query, setQuery] = useState('');

  const normalizedOptions = useMemo(() => {
    return options.map((option) =>
      typeof option === 'string' ? { label: option, value: option } : option
    );
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (query === '') {
      return normalizedOptions;
    }

    const lowerQuery = query.toLowerCase();
    return normalizedOptions.filter((option) =>
      option.label.toLowerCase().includes(lowerQuery)
    );
  }, [query, normalizedOptions]);

  const displayValue = normalizedOptions.find((option) => option.value === value)?.label || value || '';

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-surface-700 mb-1.5">
        {label}
      </label>
      <Combobox
        value={value}
        onChange={(nextValue) => {
          onChange(nextValue);
          setQuery('');
        }}
        disabled={disabled}
      >
        <div className="relative">
          <Combobox.Input
            id={id}
            className="input pr-10"
            displayValue={() => displayValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              setQuery(nextValue);
              onChange(nextValue);
            }}
            placeholder={placeholder}
          />
          <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-3">
            <ChevronUpDownIcon
              className="h-5 w-5 text-surface-400"
              aria-hidden="true"
            />
          </Combobox.Button>

          <Combobox.Options className="absolute z-20 mt-1.5 max-h-60 w-full overflow-auto rounded-xl bg-white py-1.5 text-base shadow-soft-lg border border-surface-200 focus:outline-none sm:text-sm">
            {allowFreeText && query !== '' && !normalizedOptions.some((o) => o.value.toLowerCase() === query.toLowerCase()) && (
              <Combobox.Option
                value={query}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-2.5 pl-4 pr-4 transition-colors ${
                    active ? 'bg-primary-50 text-primary-900' : 'text-surface-800'
                  }`
                }
              >
                <span className="block truncate">
                  Use &ldquo;{query}&rdquo;
                </span>
              </Combobox.Option>
            )}
            {filteredOptions.length === 0 && query !== '' && !allowFreeText ? (
              <div className="relative cursor-default select-none px-4 py-3 text-surface-500">
                No results found.
              </div>
            ) : (
              filteredOptions.map((option) => (
                <Combobox.Option
                  key={`${option.value}-${option.label}`}
                  value={option.value}
                  className={({ active }) =>
                    `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${
                      active ? 'bg-primary-50 text-primary-900' : 'text-surface-800'
                    }`
                  }
                >
                  {({ selected, active }) => (
                    <>
                      <span
                        className={`block truncate ${
                          selected ? 'font-medium' : 'font-normal'
                        }`}
                      >
                        {option.label}
                      </span>
                      {selected ? (
                        <span
                          className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                            active ? 'text-primary-600' : 'text-primary-600'
                          }`}
                        >
                          <CheckIcon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      ) : null}
                    </>
                  )}
                </Combobox.Option>
              ))
            )}
          </Combobox.Options>
        </div>
      </Combobox>
    </div>
  );
}
