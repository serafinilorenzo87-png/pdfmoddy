/**
 * `cn(...inputs)` — class-name merger used by UI primitives.
 * Combines clsx (conditional joining) with tailwind-merge
 * (deduplicates conflicting Tailwind utilities).
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
