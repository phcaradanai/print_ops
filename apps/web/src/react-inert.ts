import 'react';

declare module 'react' {
  interface HTMLAttributes<T> {
    /** Native inert background handling is used whenever mobile navigation is closed. */
    inert?: boolean;
  }
}

export {};
