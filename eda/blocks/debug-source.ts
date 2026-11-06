import { isValidElement, type ReactNode } from 'react';
/** Export the compiler's already resolved native tree for official CLI diagnostics.
 * This accepts data and intrinsic elements only; it never serializes callbacks. */
export function nativeDebugSource(node: ReactNode): string {
  const expression = (value: any): string => {
    if (isValidElement(value)) return element(value);
    if (Array.isArray(value)) return `[${value.map(expression).join(',')}]`;
    if (value === undefined) return 'undefined';
    if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${expression(v)}`).join(',')}}`;
    throw new Error('Native diagnostic export requires serializable intrinsic props');
  };
  const element = (value: any): string => {
    if (!isValidElement(value) || typeof value.type !== 'string') throw new Error('Native diagnostic export requires intrinsic elements');
    const props = value.props as Record<string, any>;
    const attributes = Object.entries(props).filter(([k, v]) => k !== 'children' && v !== undefined).map(([k, v]) => ` ${k}={${expression(v)}}`).join('');
    const children = (Array.isArray(props.children) ? props.children.flat(Infinity) : [props.children]).filter((v: any) => v !== null && v !== undefined && v !== false).map((v: any) => isValidElement(v) ? element(v) : `{${expression(v)}}`).join('');
    return `<${value.type}${attributes}>${children}</${value.type}>`;
  };
  return `// Deterministic diagnostic export of resolved, receipt-bound compiler data.\nimport React from 'react';\nexport default function Board(){return (${element(node)});}\n`;
}
