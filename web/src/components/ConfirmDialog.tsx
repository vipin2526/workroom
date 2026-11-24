import { useEffect, useRef } from 'react';
import type { ConfirmOptions } from '../lib/types';
import {
  AlertTriangleIcon,
  InfoIcon,
  TrashIcon,
  XIcon,
} from './Icons';

interface ConfirmDialogProps {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ options, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmBtnRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const tone = options.tone ?? 'warning';

  return (
    <div
      className="overlay confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={`confirm-dialog confirm-tone-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
      >
        <div className="confirm-dialog-top">
          <div className={`confirm-badge confirm-badge-${tone}`}>
            {tone === 'danger' ? (
              <TrashIcon size={20} />
            ) : tone === 'warning' ? (
              <AlertTriangleIcon size={20} />
            ) : (
              <InfoIcon size={20} />
            )}
          </div>
          <button
            type="button"
            className="icon-btn confirm-close-btn"
            onClick={onCancel}
            aria-label="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="confirm-dialog-content">
          <h2 id="confirm-dialog-title" className="confirm-title">
            {options.title}
          </h2>
          <p id="confirm-dialog-desc" className="confirm-message">
            {options.message}
          </p>
        </div>

        <div className="confirm-actions">
          <button
            type="button"
            className="btn btn-quiet confirm-cancel-btn"
            onClick={onCancel}
          >
            {options.cancelText ?? 'Cancel'}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`btn ${
              tone === 'danger'
                ? 'btn-danger'
                : tone === 'warning'
                  ? 'btn-warning-action'
                  : 'btn-primary'
            } confirm-ok-btn`}
            onClick={onConfirm}
          >
            {options.confirmText ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
