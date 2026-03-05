'use client';

import { useState, useMemo } from 'react';
import { Combobox } from '@headlessui/react';
import { CheckIcon } from '@heroicons/react/20/solid';

interface InlineComboboxProps {
  options: readonly { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  id?: string;
  allowFreeText?: boolean;
}

export function InlineCombobox({
  options,
  value,
  onChange,
  placeholder,
  id,
  allowFreeText = false,
}: InlineComboboxProps) {
  const [query, setQuery] = useState('');

  const filteredOptions = useMemo(() => {
    if (query === '') return options;
    const lowerQuery = query.toLowerCase();
    return options.filter((option) =>
      option.label.toLowerCase().includes(lowerQuery)
    );
  }, [query, options]);

  const displayValue = options.find((o) => o.value === value)?.label || value || '';

  return (
    <Combobox
      value={value}
      onChange={(nextValue) => {
        onChange(nextValue);
        setQuery('');
      }}
    >
      <div className="relative inline-block">
        <Combobox.Input
          id={id}
          className="bg-transparent border-0 border-b border-dashed border-[#505050] rounded-none text-[#E0E0E0] font-medium placeholder:text-[#606060] focus:outline-none focus:border-[#808080] text-sm w-auto min-w-[60px] cursor-pointer px-0 py-0"
          style={{ width: `${Math.max((displayValue || placeholder).length, 6) * 0.55 + 1.5}em` }}
          displayValue={() => displayValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setQuery(nextValue);
            if (allowFreeText) onChange(nextValue);
          }}
          placeholder={placeholder}
        />

        <Combobox.Options className="absolute z-30 mt-2 max-h-48 w-56 overflow-auto rounded-lg bg-[#252525] py-1 text-sm shadow-xl border border-[#404040] focus:outline-none left-0">
          {allowFreeText && query !== '' && !options.some((o) => o.value.toLowerCase() === query.toLowerCase()) && (
            <Combobox.Option
              value={query}
              className={({ active }) =>
                `cursor-pointer select-none py-2 px-3 transition-colors ${
                  active ? 'bg-[#383838] text-white' : 'text-[#A0A0A0]'
                }`
              }
            >
              <span className="block truncate">Use &ldquo;{query}&rdquo;</span>
            </Combobox.Option>
          )}
          {filteredOptions.length === 0 && query !== '' && !allowFreeText ? (
            <div className="px-3 py-2 text-[#606060]">No results found.</div>
          ) : (
            filteredOptions.map((option) => (
              <Combobox.Option
                key={`${option.value}-${option.label}`}
                value={option.value}
                className={({ active }) =>
                  `cursor-pointer select-none py-2 pl-8 pr-3 transition-colors ${
                    active ? 'bg-[#383838] text-white' : 'text-[#A0A0A0]'
                  }`
                }
              >
                {({ selected }) => (
                  <>
                    <span className={`block truncate ${selected ? 'font-medium text-white' : ''}`}>
                      {option.label}
                    </span>
                    {selected && (
                      <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-[#808080]">
                        <CheckIcon className="h-4 w-4" aria-hidden="true" />
                      </span>
                    )}
                  </>
                )}
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </div>
    </Combobox>
  );
}
