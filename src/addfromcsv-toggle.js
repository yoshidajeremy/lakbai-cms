import React, { useState, useEffect } from 'react';

// A simple toggle switch component for ignoring columns (no checkbox)
const AddFromCsvToggle = ({ label, checked, onChange }) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      cursor: 'pointer',
      fontSize: 14,
      width: '100%',
      marginBottom: 6,
    }}
  >
    <span>{label.replace(/^Ignore\s+/, '')}</span>
    <span
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        background: checked ? '#10b981' : '#d1d5db',
        borderRadius: 12,
        display: 'inline-block',
        position: 'relative',
        transition: 'background 0.2s',
        marginLeft: 4,
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: checked ? 18 : 2,
          top: 2,
          width: 16,
          height: 16,
          background: '#fff',
          borderRadius: '50%',
          boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          transition: 'left 0.2s',
        }}
      />
    </span>
  </label>
);

// Dropdown menu for toggles
export const IgnoreColumnsDropdown = ({ columns, ignored, onToggle, disabled = false }) => {
  const [open, setOpen] = useState(false);

  // Disable if parent says so OR there are no columns to ignore
  const isDisabled = disabled || !columns || columns.length === 0;

  // Close dropdown automatically when it becomes disabled
  useEffect(() => {
    if (isDisabled) setOpen(false);
  }, [isDisabled]);

  return (
    <div style={{ position: 'relative', display: 'inline-block'}}>
      <button
        onClick={() => !isDisabled && setOpen(o => !o)}
        disabled={isDisabled}
        title={isDisabled ? 'No columns to ignore' : undefined}
        style={{
          padding: '8px 16px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          background: isDisabled ? '#f3f4f6' : '#fff',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          fontWeight: 500,
          color: isDisabled ? '#9ca3af' : 'inherit',
        }}
      >
        Ignore Columns
      </button>
      {open && !isDisabled && (
        <div
          style={{
            position: 'absolute',
            top: '110%',
            left: 0,
            background: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            zIndex: 100,
            minWidth: 220,
            padding: 12,
          }}
        >
          {columns.map(col => (
            <AddFromCsvToggle
              key={col}
              label={`"${col}"`}
              checked={ignored.includes(col)}
              onChange={() => onToggle(col)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export function ImportOnlyColumnsDropdown({ columns, imported, disabled, onToggle }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px solid #2563eb',
          background: disabled ? '#f3f4f6' : '#fff',
          color: '#2563eb',
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          marginLeft: 0,
        }}
      >
        Import Only
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '110%',
          left: 0,
          background: '#fff',
          border: '1px solid #d1d5db',
          borderRadius: 8,
          boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          zIndex: 100,
          minWidth: 220,
          padding: 12,
        }}>
          {columns.map(label => (
            <label
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                cursor: 'pointer',
                fontSize: 15,
                width: '100%',
                marginBottom: 6,
              }}
            >
              <span>{`"${label}"`}</span>
              <span
                onClick={() => onToggle(label)}
                style={{
                  width: 36,
                  height: 20,
                  background: imported.includes(label) ? '#10b981' : '#d1d5db',
                  borderRadius: 12,
                  display: 'inline-block',
                  position: 'relative',
                  transition: 'background 0.2s',
                  marginLeft: 4,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: imported.includes(label) ? 18 : 2,
                    top: 2,
                    width: 16,
                    height: 16,
                    background: '#fff',
                    borderRadius: '50%',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    transition: 'left 0.2s',
                  }}
                />
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default AddFromCsvToggle;