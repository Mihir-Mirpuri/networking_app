'use client';

import { useState, useMemo } from 'react';
import { Combobox } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';

interface SearchableComboboxProps {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}

export function SearchableCombobox({
  options,
  value,
  onChange,
  label,
  placeholder = 'Search...',
  id,
  disabled = false,
}: SearchableComboboxProps) {
  const [query, setQuery] = useState('');

  const filteredOptions = useMemo(() => {
    if (query === '') {
      return options;
    }

    const lowerQuery = query.toLowerCase();
    return options.filter((option) =>
      option.toLowerCase().includes(lowerQuery)
    );
  }, [query, options]);

  const displayValue = value || '';

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <Combobox value={value} onChange={onChange} disabled={disabled}>
        <div className="relative">
          <Combobox.Input
            id={id}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            displayValue={() => displayValue}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
          />
          <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon
              className="h-5 w-5 text-gray-400"
              aria-hidden="true"
            />
          </Combobox.Button>

          <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
            {filteredOptions.length === 0 && query !== '' ? (
              <div className="relative cursor-default select-none px-4 py-2 text-gray-700">
                No results found.
              </div>
            ) : (
              filteredOptions.map((option) => (
                <Combobox.Option
                  key={option}
                  value={option}
                  className={({ active }) =>
                    `relative cursor-default select-none py-2 pl-10 pr-4 ${
                      active ? 'bg-blue-600 text-white' : 'text-gray-900'
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
                        {option}
                      </span>
                      {selected ? (
                        <span
                          className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                            active ? 'text-white' : 'text-blue-600'
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
