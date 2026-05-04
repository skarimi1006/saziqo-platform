'use client';

import { useMemo } from 'react';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const TOKEN_CLASS = {
  key: 'text-primary',
  string: 'text-emerald-700 dark:text-emerald-400',
  number: 'text-amber-700 dark:text-amber-400',
  boolean: 'text-violet-700 dark:text-violet-400',
  null: 'text-muted-foreground',
  punctuation: 'text-muted-foreground',
};

function renderValue(value: JsonValue, indent: number): React.ReactNode {
  const pad = '  '.repeat(indent);
  const childPad = '  '.repeat(indent + 1);

  if (value === null) return <span className={TOKEN_CLASS.null}>null</span>;
  if (typeof value === 'string') {
    return <span className={TOKEN_CLASS.string}>{JSON.stringify(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span className={TOKEN_CLASS.number}>{String(value)}</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={TOKEN_CLASS.boolean}>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={TOKEN_CLASS.punctuation}>[]</span>;
    return (
      <>
        <span className={TOKEN_CLASS.punctuation}>[</span>
        {'\n'}
        {value.map((item, i) => (
          <span key={i}>
            {childPad}
            {renderValue(item, indent + 1)}
            {i < value.length - 1 && <span className={TOKEN_CLASS.punctuation}>,</span>}
            {'\n'}
          </span>
        ))}
        {pad}
        <span className={TOKEN_CLASS.punctuation}>]</span>
      </>
    );
  }
  // object
  const entries = Object.entries(value);
  if (entries.length === 0) return <span className={TOKEN_CLASS.punctuation}>{'{}'}</span>;
  return (
    <>
      <span className={TOKEN_CLASS.punctuation}>{'{'}</span>
      {'\n'}
      {entries.map(([key, v], i) => (
        <span key={key}>
          {childPad}
          <span className={TOKEN_CLASS.key}>{JSON.stringify(key)}</span>
          <span className={TOKEN_CLASS.punctuation}>: </span>
          {renderValue(v, indent + 1)}
          {i < entries.length - 1 && <span className={TOKEN_CLASS.punctuation}>,</span>}
          {'\n'}
        </span>
      ))}
      {pad}
      <span className={TOKEN_CLASS.punctuation}>{'}'}</span>
    </>
  );
}

export function JsonView({ value }: { value: unknown }) {
  const tree = useMemo(() => renderValue(value as JsonValue, 0), [value]);
  return (
    <pre
      dir="ltr"
      className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed"
    >
      {tree}
    </pre>
  );
}
