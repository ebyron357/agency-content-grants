import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

// A simple Dialog alternative built from scratch to avoid complex Radix setups for simple use cases
// Or use primitive dialog if we want. For now, let's just make a very basic modal container.

export function Modal({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-card text-card-foreground rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-serif font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            &times;
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

// Select wrapper
export function Select({ value, onChange, options, placeholder }: { value: string, onChange: (v: string) => void, options: {label: string, value: string}[], placeholder?: string }) {
  return (
    <select 
      value={value} 
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
